import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT
} from 'jose';
import { createOAuthRuntime } from '../server/auth.mjs';

const issuer = 'https://react-review-ai.us.auth0.com/';
const resource = 'https://react-review-ai-demo.contacteinfo71.workers.dev/mcp';
const jwksUrl = 'https://react-review-ai.us.auth0.com/.well-known/jwks.json';

async function createAuth0Fixture() {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  Object.assign(jwk, { kid: 'auth0-d6-fixture', alg: 'RS256', use: 'sig' });
  const jwks = createLocalJWKSet({ keys: [jwk] });

  async function issue({ audience = [resource, 'https://react-review-ai.us.auth0.com/userinfo'], scope = 'review:read' } = {}) {
    return new SignJWT({ scope, azp: 'auth0-chatgpt-cimd-fixture' })
      .setProtectedHeader({ alg: 'RS256', kid: 'auth0-d6-fixture', typ: 'JWT' })
      .setIssuer(issuer)
      .setSubject('auth0|d6-fixture-user')
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
  }

  return { jwks, issue };
}

const authEnv = {
  NODE_ENV: 'production',
  OAUTH_ISSUER_URL: issuer,
  OAUTH_JWKS_URL: jwksUrl,
  MCP_PUBLIC_URL: resource,
  OAUTH_REQUIRED_SCOPE: 'review:read'
};

test('Auth0 RS256 JWT accepts the exact MCP audience even when aud also contains the OIDC userinfo audience', async () => {
  const fixture = await createAuth0Fixture();
  const runtime = createOAuthRuntime(authEnv, { jwks: fixture.jwks });
  const token = await fixture.issue();
  const request = new Request(resource, {
    headers: { authorization: `Bearer ${token}` }
  });

  const result = await runtime.authenticate(request);
  assert.equal(result.clientId, 'auth0|d6-fixture-user');
  assert.deepEqual(result.scopes, ['review:read']);
  assert.equal(result.resource.href, resource);
});

test('Auth0 access token with a wrong API audience is rejected with 401', async () => {
  const fixture = await createAuth0Fixture();
  const runtime = createOAuthRuntime(authEnv, { jwks: fixture.jwks });
  const token = await fixture.issue({ audience: 'https://another-api.example.test' });
  const response = await runtime.authenticate(new Request(resource, {
    headers: { authorization: `Bearer ${token}` }
  }));

  assert.ok(response instanceof Response);
  assert.equal(response.status, 401);
  assert.match(response.headers.get('www-authenticate'), /resource_metadata=/);
});

test('Auth0 access token without review:read is rejected with 403', async () => {
  const fixture = await createAuth0Fixture();
  const runtime = createOAuthRuntime(authEnv, { jwks: fixture.jwks });
  const token = await fixture.issue({ scope: 'openid profile' });
  const response = await runtime.authenticate(new Request(resource, {
    headers: { authorization: `Bearer ${token}` }
  }));

  assert.ok(response instanceof Response);
  assert.equal(response.status, 403);
  assert.match(response.headers.get('www-authenticate'), /insufficient_scope/);
});

test('Auth0 configuration uses exact issuer, JWKS URL, canonical resource, and required scope', async () => {
  const fixture = await createAuth0Fixture();
  const runtime = createOAuthRuntime(authEnv, { jwks: fixture.jwks });

  assert.equal(runtime.config.issuer, issuer);
  assert.equal(runtime.config.jwksUrl.href, jwksUrl);
  assert.equal(runtime.config.resource.href, resource);
  assert.equal(runtime.config.scope, 'review:read');
  assert.equal(runtime.config.metadataUrl, 'https://react-review-ai-demo.contacteinfo71.workers.dev/.well-known/oauth-protected-resource');
});
