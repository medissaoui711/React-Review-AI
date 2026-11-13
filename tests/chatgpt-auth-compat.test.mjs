import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createHttpServer } from '../server/http.mjs';

const issuer = 'https://identity.example.test/';
const resource = 'https://mcp.example.test/mcp';

async function createTestIdentity() {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  Object.assign(jwk, { kid: 'phase-3-6-key', alg: 'RS256', use: 'sig' });
  const jwks = createLocalJWKSet({ keys: [jwk] });
  const token = await new SignJWT({ scope: 'review:read' })
    .setProtectedHeader({ alg: 'RS256', kid: 'phase-3-6-key' })
    .setIssuer(issuer)
    .setSubject('phase-3-6-user')
    .setAudience(resource)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);
  const insufficientToken = await new SignJWT({ scope: 'profile:read' })
    .setProtectedHeader({ alg: 'RS256', kid: 'phase-3-6-key' })
    .setIssuer(issuer)
    .setSubject('phase-3-6-user')
    .setAudience(resource)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);
  return { jwks, token, insufficientToken };
}

async function withOAuthServer(run) {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'react-review-ai-phase-3-6-'));
  const root = path.join(parent, 'project');
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, 'Sample.jsx'), 'export function Sample() { return <img src="/x.png" />; }');
  const previous = {
    REACT_REVIEW_ROOT: process.env.REACT_REVIEW_ROOT,
    OAUTH_ISSUER_URL: process.env.OAUTH_ISSUER_URL,
    OAUTH_JWKS_URL: process.env.OAUTH_JWKS_URL,
    MCP_PUBLIC_URL: process.env.MCP_PUBLIC_URL,
    OAUTH_REQUIRED_SCOPE: process.env.OAUTH_REQUIRED_SCOPE
  };
  process.env.REACT_REVIEW_ROOT = root;
  process.env.OAUTH_ISSUER_URL = issuer;
  process.env.OAUTH_JWKS_URL = 'https://identity.example.test/.well-known/jwks.json';
  process.env.MCP_PUBLIC_URL = resource;
  process.env.OAUTH_REQUIRED_SCOPE = 'review:read';
  const identity = await createTestIdentity();
  const runtime = createHttpServer({
    NODE_ENV: 'test',
    REACT_REVIEW_ROOT: root,
    OAUTH_ISSUER_URL: issuer,
    OAUTH_JWKS_URL: 'https://identity.example.test/.well-known/jwks.json',
    MCP_PUBLIC_URL: resource,
    MCP_ALLOWED_ORIGIN_HOSTS: 'client.example.test'
  }, { jwks: identity.jwks });

  try {
    await new Promise((resolve, reject) => {
      runtime.server.once('error', reject);
      runtime.server.listen(0, '127.0.0.1', resolve);
    });
    const address = runtime.server.address();
    await run({ endpoint: `http://127.0.0.1:${address.port}/mcp`, ...identity });
  } finally {
    runtime.server.closeAllConnections();
    await runtime.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(parent, { recursive: true, force: true });
  }
}

async function connectClient(endpoint, authorization) {
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    requestInit: authorization ? { headers: { authorization: `Bearer ${authorization}` } } : undefined
  });
  const client = new Client(
    { name: 'react-review-ai-phase-3-6-test', version: '1.0.0' },
    { versionNegotiation: { mode: { pin: '2026-07-28' } } }
  );
  await client.connect(transport);
  assert.equal(client.getProtocolEra(), 'modern');
  return client;
}

const toolCalls = [
  ['review_project', {}],
  ['review_component', { file_path: 'Sample.jsx' }],
  ['run_test_audit', {}],
  ['audit_accessibility', {}]
];

test('ChatGPT-compatible tool metadata and OAuth challenges support discovery before authentication', { timeout: 60000 }, async () => {
  await withOAuthServer(async ({ endpoint }) => {
    const client = await connectClient(endpoint);
    try {
      const listed = await client.listTools();
      assert.equal(listed.tools.length, 4);
      for (const tool of listed.tools) {
        assert.deepEqual(tool._meta?.securitySchemes, [
          { type: 'oauth2', scopes: ['review:read'] }
        ]);
      }

      for (const [name, args] of toolCalls) {
        const result = await client.callTool({ name, arguments: args });
        assert.equal(result.isError, true, `${name} must require authentication`);
        const challenges = result._meta?.['mcp/www_authenticate'];
        assert.ok(Array.isArray(challenges) && challenges.length === 1);
        assert.match(challenges[0], /resource_metadata=/);
        assert.match(challenges[0], /error="invalid_token"/);
        assert.match(challenges[0], /error_description=/);
      }
    } finally {
      await client.close();
    }
  });
});

test('valid provider-neutral OAuth access token authorizes all four read-only tools', { timeout: 60000 }, async () => {
  await withOAuthServer(async ({ endpoint, token }) => {
    const client = await connectClient(endpoint, token);
    try {
      const listed = await client.listTools();
      assert.equal(listed.tools.length, 4);
      for (const [name, args] of toolCalls) {
        const result = await client.callTool({ name, arguments: args });
        assert.notEqual(result.isError, true, `${name} must accept the verified token`);
        assert.ok(result.structuredContent || result.content?.length);
      }
    } finally {
      await client.close();
    }
  });
});

test('valid JWT without the required scope returns an insufficient-scope tool challenge', { timeout: 60000 }, async () => {
  await withOAuthServer(async ({ endpoint, insufficientToken }) => {
    const client = await connectClient(endpoint, insufficientToken);
    try {
      const listed = await client.listTools();
      assert.equal(listed.tools.length, 4);
      const result = await client.callTool({ name: 'review_project', arguments: {} });
      assert.equal(result.isError, true);
      const challenge = result._meta?.['mcp/www_authenticate']?.[0] || '';
      assert.match(challenge, /error="insufficient_scope"/);
      assert.match(challenge, /error_description=/);
    } finally {
      await client.close();
    }
  });
});

test('invalid bearer token does not block server discovery or tools/list but produces an invalid-token tool challenge', { timeout: 60000 }, async () => {
  await withOAuthServer(async ({ endpoint }) => {
    const client = await connectClient(endpoint, 'not-a-valid-jwt');
    try {
      const listed = await client.listTools();
      assert.equal(listed.tools.length, 4);
      const result = await client.callTool({ name: 'review_project', arguments: {} });
      assert.equal(result.isError, true);
      assert.match(result._meta?.['mcp/www_authenticate']?.[0] || '', /error="invalid_token"/);
    } finally {
      await client.close();
    }
  });
});
