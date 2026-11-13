import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  createLocalJWKSet,
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

async function makeKeys() {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = 'phase-3-5-test-key';
  publicJwk.alg = 'RS256';
  publicJwk.use = 'sig';
  return { privateKey, jwks: createLocalJWKSet({ keys: [publicJwk] }) };
}

async function tokenFor(privateKey, overrides = {}) {
  return new SignJWT({
    scope: 'review:read',
    ...overrides.claims
  })
    .setProtectedHeader({ alg: overrides.alg || 'RS256', kid: 'phase-3-5-test-key' })
    .setIssuer(overrides.issuer || issuer)
    .setSubject(overrides.subject || 'test-user')
    .setAudience(overrides.audience || resource)
    .setIssuedAt()
    .setExpirationTime(overrides.expiration || '5m')
    .sign(privateKey);
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

test('HTTP endpoint exposes guarded resource metadata and challenges unauthenticated MCP calls', async () => {
  const { jwks } = await makeKeys();
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
    assert.equal(allowedBrowserOrigin.status, 401);
    assert.match(allowedBrowserOrigin.headers.get('www-authenticate') || '', /resource_metadata=/);

    const unauthenticated = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    });
    assert.equal(unauthenticated.status, 401);
    assert.match(unauthenticated.headers.get('www-authenticate') || '', /resource_metadata=/);

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
