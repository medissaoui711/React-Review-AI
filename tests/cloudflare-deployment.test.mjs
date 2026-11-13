import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('container image runs the existing HTTP server as a non-root user', async () => {
  const dockerfile = await read('Dockerfile');
  assert.match(dockerfile, /FROM node:22-bookworm-slim/);
  assert.match(dockerfile, /npm ci --omit=dev/);
  assert.match(dockerfile, /COPY server \.\/server/);
  assert.match(dockerfile, /COPY demo-project \.\/demo-project/);
  assert.match(dockerfile, /USER node/);
  assert.match(dockerfile, /CMD \["node", "server\/http\.mjs"\]/);
});

test('Cloudflare config binds one lite container to the named Durable Object', async () => {
  const config = await read('cloudflare.config.ts');
  assert.match(config, /defineContainer/);
  assert.match(config, /schedulingPolicy: "durable_object"/);
  assert.match(config, /images:\s*\{/);
  assert.match(config, /dockerfile: "\.\/Dockerfile"/);
  assert.doesNotMatch(config, /maxInstances|instanceType/);
  assert.match(config, /maxInstances: 1/);
  assert.match(config, /exports\.durableObject/);
  assert.match(config, /bindings\.durableObject/);
  assert.doesNotMatch(config, /wrangler\.toml|wrangler\.jsonc/);
});

test('public Worker exposes only the intended MCP and health routes', async () => {
  const worker = await read('cloudflare/worker.ts');
  for (const route of ['/mcp', '/.well-known/oauth-protected-resource', '/healthz', '/readyz']) {
    assert.ok(worker.includes(route), `Missing route ${route}`);
  }
  assert.match(worker, /OAUTH_ISSUER_URL/);
  assert.match(worker, /OAUTH_JWKS_URL/);
  assert.match(worker, /Public demo authentication is not configured/);
  assert.match(worker, /headers\.delete\("x-mcp-rate-limit-key"\)/);
  assert.match(worker, /cf-connecting-ip/);
  assert.match(worker, /setInactivityTimeout/);
  assert.match(worker, /interceptOutboundHttps/);
  assert.match(worker, /enableInternet: false/);
  assert.match(worker, /class JwksEgress extends WorkerEntrypoint/);
  assert.doesNotMatch(worker, /enableInternet: true/);
  assert.match(worker, /getTcpPort\(PORT\)\.fetch/);
  assert.match(worker, /REACT_REVIEW_ROOT: "\/app\/demo-project"/);
});

test('HTTP host and rate-limit controls accept only explicit Cloudflare forwarding inputs', async () => {
  const http = await read('server/http.mjs');
  assert.match(http, /MCP_ALLOWED_HOSTS/);
  assert.match(http, /MCP_ALLOWED_ORIGIN_HOSTS/);
  assert.match(http, /request\.headers\['x-mcp-rate-limit-key'\]/);
});

test('demo fixture is a fixed read-only React review target', async () => {
  const app = await read('demo-project/src/App.jsx');
  const component = await read('demo-project/src/components/WelcomeCard.jsx');
  assert.match(app, /React Review AI Demo/);
  assert.match(app, /<img src="\/demo-logo\.svg"\s*\/>/);
  assert.match(component, /onClick/);
  assert.match(component, /console\.log/);
});

test('Cloudflare deployment remains manual and is not triggered by CI', async () => {
  const workflow = await read('.github/workflows/mcp-ci.yml');
  assert.match(workflow, /phase-demo-cloudflare/);
  assert.match(workflow, /cloudflare:build/);
  assert.doesNotMatch(workflow, /cf deploy/);
});
