import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createServer as createNodeServer, request as nodeRequest } from 'node:http';
import {
  createLocalJWKSet,
  createRemoteJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT
} from 'jose';
import { OAuthError, OAuthErrorCode } from '@modelcontextprotocol/server';
import {
  createJwtTokenVerifier,
  createOAuthRuntime,
  createRequestRateLimiter,
  enforceRequestBodyLimit,
  readAuthConfig
} from '../server/auth.mjs';
import { createHttpServer } from '../server/http.mjs';

const issuer = 'https://identity.example.test/';
const resource = 'https://mcp.example.test/mcp';

async function makeKeys(kid = 'phase-3-5-test-key') {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = kid;
  publicJwk.alg = 'RS256';
  publicJwk.use = 'sig';
  return { privateKey, publicJwk, jwks: createLocalJWKSet({ keys: [publicJwk] }) };
}

async function tokenFor(privateKey, overrides = {}) {
  return new SignJWT({
    scope: 'review:read',
    ...overrides.claims
  })
    .setProtectedHeader({ alg: overrides.alg || 'RS256', kid: overrides.kid || 'phase-3-5-test-key' })
    .setIssuer(overrides.issuer || issuer)
    .setSubject(overrides.subject || 'test-user')
    .setAudience(overrides.audience || resource)
    .setIssuedAt()
    .setExpirationTime(overrides.expiration || '5m')
    .sign(privateKey);
}

function remoteHealthRequest(port, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = nodeRequest({
      hostname: 'mcp.example.test',
      port,
      path: '/healthz',
      method: 'GET',
      headers,
      lookup: (_hostname, options, callback) => {
        if (options?.all) callback(null, [{ address: '127.0.0.1', family: 4 }]);
        else callback(null, '127.0.0.1', 4);
      }
    }, response => {
      response.resume();
      response.once('end', () => resolve(response.statusCode));
    });
    request.once('error', reject);
    request.end();
  });
}

function testEnv(overrides = {}) {
  return {
    NODE_ENV: 'test',
    OAUTH_ISSUER_URL: issuer,
    OAUTH_JWKS_URL: 'https://identity.example.test/.well-known/jwks.json',
    MCP_PUBLIC_URL: 'http://127.0.0.1:3000/mcp',
    MCP_ALLOWED_ORIGIN_HOSTS: 'client.example.test',
    ...overrides
  };
}

test('OAuth configuration fails closed when partially configured', () => {
  assert.throws(
    () => readAuthConfig({ OAUTH_ISSUER_URL: issuer }),
    /OAUTH_JWKS_URL is required/
  );
});

test('production OAuth issuer and JWKS URLs must use HTTPS', () => {
  assert.throws(() => readAuthConfig({
    OAUTH_ISSUER_URL: 'http://identity.example.test',
    OAUTH_JWKS_URL: 'https://identity.example.test/jwks',
    MCP_PUBLIC_URL: resource
  }), /OAUTH_ISSUER_URL must use HTTPS/);
});

test('MCP public resource URL must be canonical /mcp without query parameters', () => {
  assert.throws(() => readAuthConfig(testEnv({
    MCP_PUBLIC_URL: 'http://127.0.0.1:3000/mcp?debug=true'
  }), { allowHttpLoopback: true }), /canonical \/mcp endpoint/);
});

test('JWT verifier accepts only valid issuer, audience, algorithm, expiry and subject', async () => {
  const { privateKey, jwks } = await makeKeys();
  const verifier = createJwtTokenVerifier({ issuer, resource, jwks });
  const token = await tokenFor(privateKey);
  const info = await verifier.verifyAccessToken(token);

  assert.equal(info.clientId, 'test-user');
  assert.deepEqual(info.scopes, ['review:read']);
  assert.equal(info.resource.href, resource);
  assert.ok(info.expiresAt > Math.floor(Date.now() / 1000));
});

test('JWT verifier rejects wrong issuer and audience with OAuth invalid_token', async () => {
  const { privateKey, jwks } = await makeKeys();
  const verifier = createJwtTokenVerifier({ issuer, resource, jwks });
  const wrongIssuer = await tokenFor(privateKey, { issuer: 'https://attacker.example.test' });
  const wrongAudience = await tokenFor(privateKey, { audience: 'https://other-resource.example.test' });

  for (const token of [wrongIssuer, wrongAudience]) {
    await assert.rejects(
      verifier.verifyAccessToken(token),
      error => error instanceof OAuthError && error.code === OAuthErrorCode.InvalidToken
    );
  }
});

test('JWT verifier rejects expired tokens and unsupported signing algorithms', async () => {
  const { privateKey, jwks } = await makeKeys();
  const verifier = createJwtTokenVerifier({ issuer, resource, jwks });
  const expired = await tokenFor(privateKey, { expiration: Math.floor(Date.now() / 1000) - 10 });
  await assert.rejects(
    verifier.verifyAccessToken(expired),
    error => error instanceof OAuthError && error.code === OAuthErrorCode.InvalidToken
  );

  const notYetValid = await new SignJWT({ scope: 'review:read' })
    .setProtectedHeader({ alg: 'RS256', kid: 'phase-3-5-test-key' })
    .setIssuer(issuer)
    .setSubject('test-user')
    .setAudience(resource)
    .setIssuedAt()
    .setNotBefore(Math.floor(Date.now() / 1000) + 60)
    .setExpirationTime('5m')
    .sign(privateKey);
  await assert.rejects(
    verifier.verifyAccessToken(notYetValid),
    error => error instanceof OAuthError && error.code === OAuthErrorCode.InvalidToken
  );

  const unsupported = await new SignJWT({ scope: 'review:read' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(issuer)
    .setSubject('test-user')
    .setAudience(resource)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode('test-only-hmac-secret'));
  await assert.rejects(
    verifier.verifyAccessToken(unsupported),
    error => error instanceof OAuthError && error.code === OAuthErrorCode.InvalidToken
  );
});


test('JWT verifier does not misclassify JWKS infrastructure failures as bad credentials', async () => {
  const { privateKey } = await makeKeys();
  const token = await tokenFor(privateKey);
  const verifier = createJwtTokenVerifier({
    issuer,
    resource,
    jwks: async () => { throw new Error('JWKS endpoint unavailable'); }
  });
  await assert.rejects(verifier.verifyAccessToken(token), /JWKS endpoint unavailable/);
});

test('remote JWKS refresh accepts rotated signing keys and surfaces provider outages', async () => {
  const first = await makeKeys('rotation-key-a');
  const second = await makeKeys('rotation-key-b');
  const third = await makeKeys('rotation-key-c');
  let activeKeys = { keys: [first.publicJwk] };
  let unavailable = false;

  const jwksServer = createNodeServer((request, response) => {
    if (unavailable) {
      response.writeHead(503, { 'content-type': 'text/plain' });
      response.end('temporarily unavailable');
      return;
    }
    response.writeHead(200, {
      'content-type': 'application/json',
      'cache-control': 'no-store'
    });
    response.end(JSON.stringify(activeKeys));
  });

  try {
    await new Promise((resolve, reject) => {
      jwksServer.once('error', reject);
      jwksServer.listen(0, '127.0.0.1', resolve);
    });
    const address = jwksServer.address();
    const remoteJwks = createRemoteJWKSet(
      new URL(`http://127.0.0.1:${address.port}/jwks`),
      { timeoutDuration: 1000, cooldownDuration: 1, cacheMaxAge: 300_000 }
    );
    const verifier = createJwtTokenVerifier({ issuer, resource, jwks: remoteJwks });

    const firstToken = await tokenFor(first.privateKey, { kid: 'rotation-key-a' });
    assert.equal((await verifier.verifyAccessToken(firstToken)).clientId, 'test-user');

    await new Promise(resolve => setTimeout(resolve, 5));
    activeKeys = { keys: [second.publicJwk] };
    const secondToken = await tokenFor(second.privateKey, { kid: 'rotation-key-b' });
    assert.equal((await verifier.verifyAccessToken(secondToken)).clientId, 'test-user');

    await new Promise(resolve => setTimeout(resolve, 5));
    unavailable = true;
    const thirdToken = await tokenFor(third.privateKey, { kid: 'rotation-key-c' });
    await assert.rejects(
      verifier.verifyAccessToken(thirdToken),
      error => !(error instanceof OAuthError)
    );

    await new Promise(resolve => setTimeout(resolve, 5));
    unavailable = false;
    activeKeys = { keys: [third.publicJwk] };
    assert.equal((await verifier.verifyAccessToken(thirdToken)).clientId, 'test-user');
  } finally {
    await new Promise(resolve => jwksServer.close(resolve));
  }
});

test('HTTP auth reports a retryable service error when JWKS infrastructure is unavailable', async () => {
  const { privateKey } = await makeKeys();
  const parent = await mkdtemp(path.join(os.tmpdir(), 'react-review-ai-jwks-outage-'));
  const root = path.join(parent, 'project');
  await mkdir(root, { recursive: true });
  const runtime = createHttpServer({
    ...testEnv(),
    REACT_REVIEW_ROOT: root
  }, {
    jwks: async () => { throw new Error('private upstream diagnostic'); }
  });

  try {
    await new Promise((resolve, reject) => {
      runtime.server.once('error', reject);
      runtime.server.listen(0, '127.0.0.1', resolve);
    });
    const address = runtime.server.address();
    const token = await tokenFor(privateKey, { audience: 'http://127.0.0.1:3000/mcp' });
    const response = await fetch(`http://127.0.0.1:${address.port}/mcp`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'mcp-protocol-version': '2026-07-28',
        accept: 'application/json, text/event-stream'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'review_project', arguments: {} }
      })
    });
    const body = await response.text();
    assert.equal(response.status, 503, body);
    assert.equal(response.headers.get('retry-after'), '5');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.doesNotMatch(body, /private upstream diagnostic/);
  } finally {
    await runtime.close();
    await rm(parent, { recursive: true, force: true });
  }
});

test('HTTP auth gate challenges missing tokens and rejects insufficient scopes', async () => {
  const { privateKey, jwks } = await makeKeys();
  const oauth = createOAuthRuntime(testEnv(), { jwks });
  const missing = await oauth.authenticate(new Request('http://127.0.0.1:3000/mcp', { method: 'POST' }));
  assert.equal(missing.status, 401);
  assert.match(missing.headers.get('www-authenticate') || '', /resource_metadata=/);

  const insufficientToken = await tokenFor(privateKey, { audience: 'http://127.0.0.1:3000/mcp', claims: { scope: 'profile:read' } });
  const denied = await oauth.authenticate(new Request('http://127.0.0.1:3000/mcp', {
    method: 'POST',
    headers: { authorization: `Bearer ${insufficientToken}` }
  }));
  assert.equal(denied.status, 403);
  assert.match(denied.headers.get('www-authenticate') || '', /insufficient_scope/);
});

test('HTTP auth gate returns verified identity for the required scope', async () => {
  const { privateKey, jwks } = await makeKeys();
  const oauth = createOAuthRuntime(testEnv(), { jwks });
  const token = await tokenFor(privateKey, { audience: 'http://127.0.0.1:3000/mcp' });
  const authInfo = await oauth.authenticate(new Request('http://127.0.0.1:3000/mcp', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` }
  }));
  assert.equal(authInfo.clientId, 'test-user');
  assert.ok(authInfo.scopes.includes('review:read'));
});

test('OAuth protected resource metadata advertises only configured issuer and scope', () => {
  const oauth = createOAuthRuntime(testEnv(), {
    jwks: createLocalJWKSet({ keys: [] })
  });
  const response = oauth.metadataResponse();
  assert.equal(response.status, 200);
  return response.json().then(metadata => {
    assert.equal(metadata.resource, 'http://127.0.0.1:3000/mcp');
    assert.deepEqual(metadata.authorization_servers, [issuer]);
    assert.deepEqual(metadata.scopes_supported, ['review:read']);
  });
});

test('remote HTTP binding is denied unless explicit remote and TLS proxy settings are present', () => {
  assert.throws(() => createHttpServer({
    NODE_ENV: 'test',
    MCP_HTTP_HOST: '0.0.0.0'
  }), /MCP_HTTP_ALLOW_REMOTE=true/);

  assert.throws(() => createHttpServer({
    NODE_ENV: 'test',
    MCP_HTTP_HOST: '0.0.0.0',
    MCP_HTTP_ALLOW_REMOTE: 'true'
  }), /OAuth configuration and MCP_TRUST_PROXY_TLS=true/);
});

test('remote HTTP mode rejects localhost Host and Origin aliases', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'react-review-ai-remote-host-'));
  const root = path.join(parent, 'project');
  await mkdir(root, { recursive: true });
  const runtime = createHttpServer(testEnv({
    REACT_REVIEW_ROOT: root,
    MCP_HTTP_HOST: '0.0.0.0',
    MCP_HTTP_ALLOW_REMOTE: 'true',
    MCP_TRUST_PROXY_TLS: 'true',
    MCP_PUBLIC_URL: 'https://mcp.example.test/mcp'
  }), {
    jwks: createLocalJWKSet({ keys: [] })
  });

  try {
    await new Promise((resolve, reject) => {
      runtime.server.once('error', reject);
      runtime.server.listen(0, '127.0.0.1', resolve);
    });
    const address = runtime.server.address();

    const localhostHost = await remoteHealthRequest(address.port, { host: 'localhost' });
    assert.ok([400, 403].includes(localhostHost));

    const publicHostLocalOrigin = await remoteHealthRequest(address.port, {
      host: 'mcp.example.test',
      origin: 'http://localhost:3000'
    });
    assert.equal(publicHostLocalOrigin, 403);

    const trustedOrigin = await remoteHealthRequest(address.port, {
      host: 'mcp.example.test',
      origin: 'https://client.example.test'
    });
    assert.equal(trustedOrigin, 200);
  } finally {
    await runtime.close();
    await rm(parent, { recursive: true, force: true });
  }
});

test('rate limiter bounds anonymous and token-keyed request bursts', () => {
  const limit = createRequestRateLimiter({ windowMs: 60_000, maxRequests: 1 });
  const request = new Request('http://localhost/mcp', { method: 'POST' });
  assert.equal(limit(request), null);
  assert.equal(limit(request).status, 429);
});

test('request body limit rejects oversized declared and streamed bodies', async () => {
  const declared = await enforceRequestBodyLimit(new Request('http://localhost/mcp', {
    method: 'POST',
    headers: { 'content-length': '20' },
    body: '{}'
  }), 10);
  assert.equal(declared.status, 413);

  const bounded = await enforceRequestBodyLimit(new Request('http://localhost/mcp', {
    method: 'POST',
    body: '0123456789abcdef'
  }), 8);
  assert.equal(bounded.status, 413);
});

test('HTTP endpoint exposes resource metadata and permits unauthenticated MCP discovery', async () => {
  const { jwks, privateKey } = await makeKeys();
  const parent = await mkdtemp(path.join(os.tmpdir(), 'react-review-ai-oauth-http-'));
  const root = path.join(parent, 'project');
  await mkdir(root, { recursive: true });
  const runtime = createHttpServer({
    ...testEnv(),
    REACT_REVIEW_ROOT: root
  }, { jwks });

  try {
    await new Promise((resolve, reject) => {
      runtime.server.once('error', reject);
      runtime.server.listen(0, '127.0.0.1', resolve);
    });
    const address = runtime.server.address();
    const base = `http://127.0.0.1:${address.port}`;

    const metadata = await fetch(`${base}/.well-known/oauth-protected-resource`);
    assert.equal(metadata.status, 200);
    const metadataBody = await metadata.json();
    assert.equal(metadataBody.resource, 'http://127.0.0.1:3000/mcp');

    const wrongOrigin = await fetch(`${base}/.well-known/oauth-protected-resource`, {
      headers: { origin: 'https://attacker.example.test' }
    });
    assert.equal(wrongOrigin.status, 403);

    const allowedBrowserOrigin = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { origin: 'https://client.example.test', 'content-type': 'application/json' },
      body: '{}'
    });
    assert.notEqual(allowedBrowserOrigin.status, 401);

    const browserToolCall = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: {
        origin: 'https://client.example.test',
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: { name: 'review_project', arguments: {} }
      })
    });
    assert.equal(browserToolCall.status, 401);
    assert.match(browserToolCall.headers.get('www-authenticate') || '', /resource_metadata=/);

    const invalidBrowserToken = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: {
        origin: 'https://client.example.test',
        authorization: 'Bearer invalid-token',
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 8,
        method: 'tools/call',
        params: { name: 'review_project', arguments: {} }
      })
    });
    assert.equal(invalidBrowserToken.status, 401);
    assert.match(invalidBrowserToken.headers.get('www-authenticate') || '', /invalid_token/);

    const insufficientBrowserToken = await tokenFor(privateKey, {
      audience: 'http://127.0.0.1:3000/mcp',
      claims: { scope: 'profile:read' }
    });
    const insufficientBrowserCall = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: {
        origin: 'https://client.example.test',
        authorization: `Bearer ${insufficientBrowserToken}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 9,
        method: 'tools/call',
        params: { name: 'review_project', arguments: {} }
      })
    });
    assert.equal(insufficientBrowserCall.status, 403);
    assert.match(insufficientBrowserCall.headers.get('www-authenticate') || '', /insufficient_scope/);

    const unauthenticated = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    });
    assert.notEqual(unauthenticated.status, 401);

    const previousRoot = process.env.REACT_REVIEW_ROOT;
    process.env.REACT_REVIEW_ROOT = root;
    try {
      const validToken = await tokenFor(privateKey, { audience: 'http://127.0.0.1:3000/mcp' });
      const authorizedRequest = await fetch(`${base}/mcp`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${validToken}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream'
        },
        body: 'not-json'
      });
      const authorizedBody = await authorizedRequest.text();
      assert.equal(authorizedRequest.status, 400, authorizedBody);
      assert.doesNotMatch(authorizedBody, /invalid_token|insufficient_scope/);
    } finally {
      if (previousRoot === undefined) delete process.env.REACT_REVIEW_ROOT;
      else process.env.REACT_REVIEW_ROOT = previousRoot;
    }

    const metadataPost = await fetch(`${base}/.well-known/oauth-protected-resource`, {
      method: 'POST'
    });
    assert.equal(metadataPost.status, 405);
  } finally {
    await runtime.close();
    await rm(parent, { recursive: true, force: true });
  }
});

test('origin allowlist rejects wildcard, scheme and port entries', () => {
  for (const value of ['*', 'https://client.example.test', 'client.example.test:443']) {
    assert.throws(
      () => createHttpServer({ ...testEnv(), MCP_ALLOWED_ORIGIN_HOSTS: value }, {
        jwks: createLocalJWKSet({ keys: [] })
      }),
      /hostnames only/
    );
  }
});
