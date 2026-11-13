import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

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
  const pushBranches = workflow.match(/^    branches: \[([^\]]+)\]$/m)?.[1]
    ?.split(',')
    .map((branch) => branch.trim());
  assert.ok(pushBranches?.includes('main'), 'MCP CI must run on main');
  assert.ok(pushBranches?.includes('phase-d6-auth0-production-certification'),
    'MCP CI must run on the active D6 branch');
  assert.ok(pushBranches?.includes('phase-demo-cloudflare-d4-readiness'));
  assert.ok(pushBranches?.includes('phase-demo-cloudflare-d5-deployment-readiness'));
  assert.ok(pushBranches?.includes('phase-3.2-secure-file-access'));
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
  assert.match(doc, /Never commit access tokens, client secrets, private signing keys/);
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


test('Cloudflare Worker enforces explicit-origin CORS for browser MCP and OAuth metadata requests', async () => {
  const worker = await read('cloudflare/worker.ts');
  assert.match(worker, /function resolveAllowedOrigin/);
  assert.match(worker, /parsed\.protocol !== "https:"/);
  assert.match(worker, /allowedHosts\.includes\(parsed\.hostname\.toLowerCase\(\)\)/);
  assert.match(worker, /Access-Control-Allow-Origin/);
  assert.match(worker, /Access-Control-Expose-Headers.*WWW-Authenticate.*Mcp-Session-Id/);
  assert.match(worker, /function corsPreflight/);
  assert.match(worker, /expectedMethods\.includes\(requestedMethod/);
  assert.match(worker, /expectedMethods\.join\(", "\)/);
  assert.match(worker, /isMcpRoute \? \["GET", "POST"\] : \["GET"\]/);
  assert.match(worker, /isMcpRoute \? \["GET", "POST"\] : \["GET"\]/);
  assert.match(worker, /requestedHeaders\.some\(\(header\) => !CORS_ALLOWED_HEADERS\.has\(header\)\)/);
  assert.match(worker, /"mcp-method"/);
  assert.match(worker, /"mcp-name"/);
  assert.match(worker, /isResourceMetadata/);
  assert.match(worker, /return respond\(await stub\.fetch\(forwarded\)\)/);
  assert.doesNotMatch(worker, /Access-Control-Allow-Origin["']?,\s*["']\*["']/);
});

test('static dashboard exposes safe MCP configuration readiness without claiming live connectivity', async () => {
  const main = await read('src/main.js');
  assert.match(main, /VITE_MCP_ENDPOINT/);
  assert.match(main, /endpoint\.protocol !== "https:"/);
  assert.match(main, /endpoint\.username/);
  assert.match(main, /endpoint\.password/);
  assert.match(main, /endpoint\.search/);
  assert.match(main, /endpoint\.hash/);
  assert.match(main, /!== "\/mcp"/);
  assert.doesNotMatch(main, /pathname\\.replace/);
  assert.match(main, /authentication, CORS, and live MCP connectivity have not been verified/i);
  assert.match(main, /Access and refresh tokens stay in memory/);
  assert.match(main, /BrowserOAuthProvider/);
  assert.match(main, /VITE_OAUTH_CLIENT_ID/);
  assert.match(main, /VITE_OAUTH_ISSUER/);
  assert.match(main, /context\.issuer !== this\.issuer/);
  assert.match(main, /StreamableHTTPClientTransport/);
  assert.match(main, /finishAuth\(params\)/);
  assert.match(main, /sessionStorage/);
  assert.match(main, /pkce-verifier/);
  assert.match(main, /OAUTH_TRANSACTION_TTL_MS/);
  assert.match(main, /created-at/);
  assert.doesNotMatch(main, /localStorage/);
  assert.doesNotMatch(main, /sessionStorage\.setItem\([^,]*(?:token|access)/i);
  assert.match(main, /mcpClient\.callTool/);
  assert.match(main, /saveTokens\(tokens\)\s*\{\s*this\.accessTokens = tokens;/);
  assert.doesNotMatch(main, /client_secret|localStorage/i);
});


test('browser OAuth provider preserves only short-lived PKCE state across redirects', async () => {
  const main = await read('src/main.js');
  const start = main.indexOf('const OAUTH_TRANSACTION_TTL_MS');
  const end = main.indexOf('let mcpClient;', start);
  assert.ok(start >= 0 && end > start, 'OAuth provider block must remain isolated before MCP UI wiring');

  const sessionValues = new Map();
  const sessionStorage = {
    getItem(key) { return sessionValues.has(key) ? sessionValues.get(key) : null; },
    setItem(key, value) { sessionValues.set(key, String(value)); },
    removeItem(key) { sessionValues.delete(key); },
  };
  let now = 1_000;
  const FakeDate = class extends Date {
    static now() { return now; }
  };
  const context = {
    window: {
      sessionStorage,
      location: { pathname: '/', origin: 'https://dashboard.example.test' },
    },
    crypto: { randomUUID: () => 'oauth-state-test' },
    Date: FakeDate,
    URL,
  };

  runInNewContext(
    main.slice(start, end) + '\nglobalThis.__BrowserOAuthProvider = BrowserOAuthProvider;',
    context,
  );

  const Provider = context.__BrowserOAuthProvider;
  const issuer = 'https://identity.example.test/';
  const provider = new Provider('public-client-id', issuer);
  const verifier = 'pkce-verifier-test';
  provider.saveCodeVerifier(verifier);
  provider.saveDiscoveryState({
    authorizationServerUrl: 'https://identity.example.test/',
    resource: 'https://mcp.example.test/mcp',
  });
  const state = provider.state();

  assert.equal(provider.pendingState, state);
  assert.equal(provider.codeVerifier(), verifier);
  assert.equal(provider.clientInformation({ issuer }).token_endpoint_auth_method, 'none');
  assert.equal('client_secret' in provider.clientInformation({ issuer }), false);
  assert.throws(() => provider.clientInformation({ issuer: 'https://attacker.example.test/' }), /does not match/);

  const restored = new Provider('public-client-id', issuer);
  assert.equal(restored.pendingState, state);
  assert.equal(restored.codeVerifier(), verifier);
  assert.equal(
    JSON.stringify(restored.discoveryState()),
    JSON.stringify({
      authorizationServerUrl: 'https://identity.example.test/',
      resource: 'https://mcp.example.test/mcp',
    }),
  );

  provider.saveTokens({ access_token: 'memory-only-access-token' });
  assert.equal(provider.tokens().access_token, 'memory-only-access-token');
  assert.ok([...sessionValues.values()].every((value) => !String(value).includes('memory-only-access-token')));
  assert.ok([...sessionValues.keys()].every((key) => !/token/i.test(key)));

  now += 10 * 60 * 1000 + 1;
  const expired = new Provider('public-client-id', issuer);
  assert.equal(expired.pendingState, null);
  assert.equal(sessionValues.size, 0);
  assert.throws(() => expired.codeVerifier(), /expired/);
});
