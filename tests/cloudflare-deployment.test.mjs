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

test('Cloudflare config binds a basic Durable Object-managed container', async () => {
  const config = await read('cloudflare.config.ts');
  assert.match(config, /defineContainer/);
  assert.match(config, /schedulingPolicy: "durable-object"/);
  assert.match(config, /images:\s*\{/);
  assert.match(config, /dockerfile: "\.\/Dockerfile"/);
  assert.doesNotMatch(config, /maxInstances|instanceType/);
  assert.match(config, /JwksEgress: exports\.worker\(\)/);
  assert.match(config, /exports\.durableObject/);
  assert.match(config, /bindings\.durableObject/);
  assert.doesNotMatch(config, /wrangler\.toml|wrangler\.jsonc/);
});

test('public Worker serves liveness and OAuth metadata at the edge without starting the Container', async () => {
  const worker = await read('cloudflare/worker.ts');
  assert.match(worker, /if \(url\.pathname === "\/healthz"\)/);
  assert.match(worker, /publicMetadata\(request, env\)/);
  assert.match(worker, /authorization_servers: \[env\.OAUTH_ISSUER_URL\]/);
  assert.match(worker, /scopes_supported: \[env\.OAUTH_REQUIRED_SCOPE \|\| "review:read"\]/);
  assert.match(worker, /url\.pathname !== "\/mcp"/);
  assert.doesNotMatch(worker, /\["\/readyz", "GET"\]/);
  assert.doesNotMatch(worker, /const ROUTES/);
  assert.match(worker, /Public demo authentication is not configured/);
  assert.match(worker, /headers\.delete\("x-mcp-rate-limit-key"\)/);
  assert.match(worker, /cf-connecting-ip/);
  assert.match(worker, /setInactivityTimeout/);
  assert.match(worker, /interceptOutboundHttps/);
  assert.match(worker, /instance: "basic"/);
  assert.match(worker, /enableInternet: false/);
  assert.match(worker, /class JwksEgress extends WorkerEntrypoint/);
  assert.doesNotMatch(worker, /enableInternet: true/);
  assert.match(worker, /getTcpPort\(PORT\)\.fetch/);
  assert.match(worker, /REACT_REVIEW_ROOT: "\/app\/demo-project"/);
  assert.match(worker, /http:\/\/container\/readyz/);
});

test('JWKS egress permits only the exact configured canonical HTTPS URL and GET', async () => {
  const worker = await read('cloudflare/worker.ts');
  assert.match(worker, /expected\.protocol !== "https:"/);
  assert.match(worker, /expected\.username !== ""/);
  assert.match(worker, /expected\.password !== ""/);
  assert.match(worker, /expected\.hash !== ""/);
  assert.match(worker, /request\.method !== "GET"/);
  assert.match(worker, /actual\.href !== expected\.href/);
  assert.match(worker, /redirect: "manual"/);
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
  assert.match(workflow, /branches: \[main, phase-demo-cloudflare-d4-readiness, phase-demo-cloudflare-d5-deployment-readiness, phase-3\.2-secure-file-access/);
  assert.match(workflow, /phase-demo-cloudflare-d4-readiness/);
  assert.match(workflow, /cloudflare:build/);
  assert.doesNotMatch(workflow, /cf deploy/);
});


test('D5 documentation accurately describes the public route boundary and owner-controlled deployment gates', async () => {
  const doc = await read('docs/phase-demo-cloudflare.md');
  assert.match(doc, /The public Worker exposes only/);
  assert.match(doc, /readyz.*internal Container probe/);
  assert.match(doc, /Workers Paid and Cloudflare Containers/);
  assert.match(doc, /exact public resource URL ending in/);
  assert.match(doc, /Do not commit access tokens, client secrets, private signing keys/);
  assert.match(doc, /separate owner approval/);
  assert.match(doc, /D6 live OAuth\/ChatGPT certification/);
  assert.doesNotMatch(doc, /Worker exposes only.*GET `\/readyz`/);
});

test('D5 CI trigger is branch-scoped and remains non-deploying', async () => {
  const workflow = await read('.github/workflows/mcp-ci.yml');
  assert.match(workflow, /phase-demo-cloudflare-d5-deployment-readiness/);
  assert.match(workflow, /cloudflare:build/);
  assert.doesNotMatch(workflow, /cf deploy/);
});
