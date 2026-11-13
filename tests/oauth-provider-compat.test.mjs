import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import test from 'node:test';
import { createLocalJWKSet, generateKeyPair, SignJWT } from 'jose';
import { createJwtTokenVerifier } from '../server/auth.mjs';

test('provider-neutral authorization server contract supports discovery, DCR, PKCE S256, resource binding and refresh rotation', async () => {
  const issuerKeys = await generateKeyPair('RS256');
  const resource = 'https://mcp.example.test/mcp';
  const codes = new Map();
  const refreshTokens = new Set();
  let refreshCounter = 0;
  let lastAuthorization;

  async function issueAccessToken(scope) {
    return new SignJWT({ scope })
      .setProtectedHeader({ alg: 'RS256', kid: 'provider-simulator-key' })
      .setIssuer(issuer)
      .setSubject('provider-simulator-user')
      .setAudience(resource)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(issuerKeys.privateKey);
  }

  const server = createServer(async (request, response) => {
    const url = new URL(request.url, issuer);
    if (url.pathname === '/.well-known/oauth-authorization-server' && request.method === 'GET') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        issuer,
        authorization_endpoint: new URL('/authorize', issuer).href,
        token_endpoint: new URL('/token', issuer).href,
        registration_endpoint: new URL('/register', issuer).href,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
        scopes_supported: ['review:read', 'offline_access'],
        authorization_response_iss_parameter_supported: true
      }));
      return;
    }

    if (url.pathname === '/register' && request.method === 'POST') {
      const body = await readJson(request);
      assert.equal(body.token_endpoint_auth_method, 'none');
      assert.ok(body.redirect_uris?.length);
      response.writeHead(201, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        client_id: 'phase-3-6-public-client',
        token_endpoint_auth_method: 'none',
        redirect_uris: body.redirect_uris
      }));
      return;
    }

    if (url.pathname === '/authorize' && request.method === 'GET') {
      const challenge = url.searchParams.get('code_challenge');
      assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
      assert.equal(url.searchParams.get('resource'), resource);
      assert.equal(url.searchParams.get('client_id'), 'phase-3-6-public-client');
      assert.equal(url.searchParams.get('response_type'), 'code');
      assert.ok(url.searchParams.get('scope').split(' ').includes('review:read'));
      assert.ok(url.searchParams.get('scope').split(' ').includes('offline_access'));
      assert.ok(challenge);
      lastAuthorization = {
        challenge,
        redirectUri: url.searchParams.get('redirect_uri'),
        state: url.searchParams.get('state'),
        resource: url.searchParams.get('resource')
      };
      codes.set('one-time-code', lastAuthorization);
      const callback = new URL(lastAuthorization.redirectUri);
      callback.searchParams.set('code', 'one-time-code');
      callback.searchParams.set('state', lastAuthorization.state);
      callback.searchParams.set('iss', issuer);
      response.writeHead(302, { location: callback.href });
      response.end();
      return;
    }

    if (url.pathname === '/token' && request.method === 'POST') {
      const form = new URLSearchParams(await readText(request));
      assert.equal(form.get('resource'), resource);
      if (form.get('grant_type') === 'authorization_code') {
        const record = codes.get(form.get('code'));
        assert.ok(record, 'authorization code must be recognized and single-use');
        codes.delete(form.get('code'));
        const verifier = form.get('code_verifier');
        const computed = createHash('sha256').update(verifier).digest('base64url');
        assert.equal(computed, record.challenge, 'PKCE verifier must match the S256 challenge');
        assert.equal(form.get('redirect_uri'), record.redirectUri);
        const accessToken = await issueAccessToken('review:read');
        refreshTokens.add('refresh-token-1');
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({
          access_token: accessToken,
          token_type: 'Bearer',
          expires_in: 300,
          scope: 'review:read',
          refresh_token: 'refresh-token-1'
        }));
        return;
      }

      if (form.get('grant_type') === 'refresh_token') {
        const oldToken = form.get('refresh_token');
        assert.ok(refreshTokens.has(oldToken), 'refresh token must be active');
        refreshTokens.delete(oldToken);
        const nextRefreshToken = `refresh-token-${++refreshCounter + 1}`;
        refreshTokens.add(nextRefreshToken);
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({
          access_token: await issueAccessToken('review:read'),
          token_type: 'Bearer',
          expires_in: 300,
          scope: 'review:read',
          refresh_token: nextRefreshToken
        }));
        return;
      }
      response.writeHead(400);
      response.end('unsupported_grant_type');
      return;
    }

    response.writeHead(404);
    response.end('not found');
  });

  async function readText(request) {
    let value = '';
    for await (const chunk of request) value += chunk;
    return value;
  }
  async function readJson(request) {
    return JSON.parse(await readText(request));
  }

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const issuer = `http://127.0.0.1:${address.port}`;

  try {
    const metadataResponse = await fetch(new URL('/.well-known/oauth-authorization-server', issuer));
    assert.equal(metadataResponse.status, 200);
    const metadata = await metadataResponse.json();
    assert.equal(metadata.issuer, issuer);
    assert.ok(metadata.code_challenge_methods_supported.includes('S256'));
    assert.ok(metadata.grant_types_supported.includes('refresh_token'));

    const registration = await fetch(metadata.registration_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_name: 'ChatGPT MCP client test',
        redirect_uris: ['http://127.0.0.1/callback'],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none'
      })
    });
    assert.equal(registration.status, 201);
    const client = await registration.json();

    const verifier = 'phase-3-6-test-verifier-with-sufficient-entropy';
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const authorizeUrl = new URL(metadata.authorization_endpoint);
    authorizeUrl.search = new URLSearchParams({
      response_type: 'code',
      client_id: client.client_id,
      redirect_uri: client.redirect_uris[0],
      code_challenge: challenge,
      code_challenge_method: 'S256',
      resource,
      scope: 'review:read offline_access',
      state: 'phase-3-6-state'
    });
    const authorization = await fetch(authorizeUrl, { redirect: 'manual' });
    assert.equal(authorization.status, 302);
    const callback = new URL(authorization.headers.get('location'));
    assert.equal(callback.searchParams.get('iss'), issuer);
    assert.equal(callback.searchParams.get('state'), 'phase-3-6-state');

    const tokenResponse = await fetch(metadata.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: callback.searchParams.get('code'),
        redirect_uri: client.redirect_uris[0],
        client_id: client.client_id,
        code_verifier: verifier,
        resource
      })
    });
    assert.equal(tokenResponse.status, 200);
    const tokens = await tokenResponse.json();
    assert.ok(tokens.refresh_token);
    const jwks = createLocalJWKSet({
      keys: [{
        ...(await import('jose')).exportJWK
          ? await (await import('jose')).exportJWK(issuerKeys.publicKey)
          : {},
        kid: 'provider-simulator-key',
        alg: 'RS256',
        use: 'sig'
      }]
    });
    const tokenVerifier = createJwtTokenVerifier({ issuer, resource, jwks });
    const authInfo = await tokenVerifier.verifyAccessToken(tokens.access_token);
    assert.equal(authInfo.resource.href, resource);
    assert.deepEqual(authInfo.scopes, ['review:read']);

    const refreshResponse = await fetch(metadata.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        client_id: client.client_id,
        resource
      })
    });
    assert.equal(refreshResponse.status, 200);
    const refreshed = await refreshResponse.json();
    assert.notEqual(refreshed.refresh_token, tokens.refresh_token);
    assert.ok(await tokenVerifier.verifyAccessToken(refreshed.access_token));

    const replay = await fetch(metadata.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: tokens.refresh_token,
        client_id: client.client_id,
        resource
      })
    });
    assert.equal(replay.status, 400);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
