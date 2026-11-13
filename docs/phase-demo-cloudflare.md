# React Review AI — Cloudflare Demo

## Status

This deployment is developed on `phase-demo-cloudflare`. It is a demo environment only. It does not change `main`, create Cloudflare resources, configure account settings, or deploy automatically.

The public Worker is intended to run on the default `workers.dev` hostname. No custom domain is required.

## Container sizing

The demo uses Cloudflare's predefined `basic` instance: 1/4 vCPU, 1 GiB memory, and 4 GB disk. This matches the approved Phase D2 sizing and provides more headroom for AST parsing than the `lite` instance (256 MiB).

## Architecture

- Cloudflare Worker: validates the route/method, overwrites the internal rate-limit key using Cloudflare's `CF-Connecting-IP`, and forwards to the named Durable Object.
- Durable Object: starts and monitors the container, waits for `/readyz`, and forwards HTTP requests to port 3000.
- Container: Node.js 22 HTTP MCP server, with a fixed demo project at `/app/demo-project`.
- MCP: existing Streamable HTTP transport and OAuth Resource Server implementation remain authoritative.

The current Cloudflare configuration uses the direct Durable Object Container API. The deprecated `@cloudflare/containers` helper package is not used.

## Security boundary

- The container is not assigned a public address; inbound requests pass through the Worker and Durable Object.
- The public Worker exposes only `POST /mcp`, `GET /.well-known/oauth-protected-resource`, and `GET /healthz`. `/readyz` is an internal Container probe reached only by the Durable Object; it is not a public Worker route.
- The Worker rejects public requests until OAuth issuer and JWKS URLs are configured.
- The container binds to `0.0.0.0:3000` internally and requires the existing remote-mode OAuth safeguards.
- The project root is fixed to `/app/demo-project`. No tool accepts a caller-supplied root.
- The Worker removes any caller-supplied `x-mcp-rate-limit-key` and replaces it with the edge-provided client address. The Node server hashes the value before using it as a rate-limit key; it is not written to request logs.
- The Cloudflare-to-container request host is explicitly allowed through `MCP_ALLOWED_HOSTS=container`.
- OAuth issuer/JWKS values and allowed Origin hostnames are runtime configuration, not committed secrets.

Container public Internet access is disabled. Before startup, the Durable Object registers an HTTPS outbound intercept for the exact hostname and path in `OAUTH_JWKS_URL`; a WorkerEntrypoint verifies the destination and forwards only that JWKS GET request, with redirects left manual. The Node process trusts Cloudflare's container interception CA through `NODE_EXTRA_CA_CERTS`. No other outbound destination is allowed. The OAuth issuer/JWKS URLs and their host must be reviewed before deployment. No access token, signing key, or client secret belongs in this repository.

## Local and CI checks

- `npm run check`
- `npm test`
- `npm run cloudflare:build`

The CI workflow validates the Cloudflare build but never runs `cf deploy`. The Cloudflare CLI and Vite plugin v2 beta are pinned in `devDependencies`; both are beta-stage tooling and remain an operational caveat. Plugin v2 is required because it reads `cloudflare.config.ts` directly.

## Owner-controlled deployment gates

Before deployment, an owner must separately approve:

1. Cloudflare account authentication and target account.
2. Required Container product availability and current plan/resource limits.
3. OAuth issuer, JWKS URL, audience/resource value, and approved Origin hostnames.
4. Outbound egress policy for JWKS retrieval.
5. Runtime secret/variable configuration.
6. A manual `cf deploy` operation.

No Cloudflare account mutation or deployment is part of this branch implementation.

## CI validation evidence

The feature-branch validation run completed successfully for the implementation tree before the generated lockfile publication:
- Cloudflare Worker and Container image build completed without deployment.
- Regression/security test suite passed (62 tests).
- MCP modern STDIO and Inspector interoperability passed.
- MCP Streamable HTTP discovery, tools/list, tools/call, Inspector interoperability, and bounded load test passed.
- AST performance benchmark completed and its artifact was uploaded.
- The workflow then regenerated and committed the npm lockfile to this feature branch.

A subsequent pull-request security run must validate the synchronized lockfile with a fresh `npm ci`; the earlier run against the pre-sync lockfile correctly failed and is not counted as a passing security result.


## Phase D4 readiness hardening

- Public `GET /healthz` and `GET /.well-known/oauth-protected-resource` are answered by the Worker edge; neither endpoint wakes the Durable Object or Container.
- Public `POST /mcp` is the only route forwarded to the Durable Object. The Container readiness probe `/readyz` is internal to the Durable Object and is not exposed by the Worker.
- JWKS egress accepts only GET requests whose complete canonical HTTPS URL exactly matches `OAUTH_JWKS_URL`; credentials and fragments are rejected, and redirects remain manual.
- Browser Origin allowlisting remains explicit through `MCP_ALLOWED_ORIGIN_HOSTS`. Requests without Origin remain supported for non-browser MCP clients. Do not guess the ChatGPT Origin; verify it against the actual deployed client before adding an allowlist entry.
- The MCP CI workflow now runs on pushes to `main` as well as the Cloudflare demo branch. Its Cloudflare step builds only and does not deploy.
- In-memory request rate limits are process-local and reset on container restart; they are not a durable, globally coordinated abuse-control system.
- Live OAuth/ChatGPT certification remains pending until a public HTTPS deployment and a real provider-neutral OAuth/OIDC issuer/JWKS configuration are available.
- Cloudflare Containers availability and billing-plan eligibility must be confirmed by the account owner before any deployment approval. No account state was changed in this phase.


## Phase D5 deployment readiness

Implementation branch: `phase-demo-cloudflare-d5-deployment-readiness`
Base: `ec0d7a09d0f8fc8d893cfc2ac73cbb656eee91d4`

Phase D5 prepares the repository and owner checklist for a controlled first deployment. It does not authenticate to or mutate a Cloudflare account, create resources, set variables/secrets, change a billing plan, or deploy.

### Pre-deployment account gate

The account owner must verify in the Cloudflare dashboard before authorizing any deployment action:

1. The intended Cloudflare account is selected and accessible to the operator.
2. Workers Paid and Cloudflare Containers are available for that account and jurisdiction.
3. The account's current Container limits, included usage, overage rates, and any applicable regional restrictions are acceptable.
4. A `workers.dev` subdomain is enabled and available for the intended Worker name.
5. The owner has reviewed the current official pricing pages; do not infer total cost from the base Workers subscription alone.

Official references:
- [Workers plans and pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Containers pricing](https://developers.cloudflare.com/containers/platform/pricing/)
- [Containers limits](https://developers.cloudflare.com/containers/platform/limits/)
- [Workers.dev subdomains](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)

No account eligibility, billing state, resource quota, or subdomain availability is asserted by this repository. These are account-specific checks.

### OAuth configuration contract

The demo remains provider-neutral. Before deployment, the owner must supply and independently verify:

- `OAUTH_ISSUER_URL`: exact issuer identifier published by the selected external OAuth/OIDC provider.
- `OAUTH_JWKS_URL`: exact HTTPS JWKS endpoint, without credentials or fragments.
- Provider-issued access tokens must be signed with RS256 or ES256 and contain the exact issuer, subject, expiry, and audience claims required by the resource server.
- The required token audience is the exact public resource URL ending in `/mcp`. The Worker derives this URL from its incoming `workers.dev` origin; the OAuth provider must be configured to issue that exact audience.
- `OAUTH_REQUIRED_SCOPE`: defaults to `review:read`; change only when the provider's issued scopes and the server setting are deliberately aligned.
- `MCP_ALLOWED_ORIGIN_HOSTS`: leave unset until the actual deployed client Origin is observed and verified. Non-browser MCP requests without Origin remain supported.

The issuer and JWKS URLs are public trust configuration, not credentials. Never commit access tokens, client secrets, private signing keys, or account API tokens. The resource server does not need an OAuth client secret and does not issue tokens.

### Controlled deployment sequence (not authorized by this phase)

After separate owner approval for account changes and deployment:

1. Confirm the account, Workers Paid/Containers eligibility, `workers.dev` availability, and cost limits.
2. Configure only the required provider issuer/JWKS values and any deliberately approved scope/origin settings using Cloudflare's secret/variable interface. Do not place values in source control or CI logs.
3. Build the Worker and Container image using the existing non-deploying CI build.
4. Review the final account target, Worker name, generated public resource URL, and OAuth audience alignment.
5. Obtain explicit approval for the exact deployment operation before running `cf deploy`.
6. After deployment, run the D6 live validation matrix before declaring the demo production-ready.

### Post-deployment acceptance evidence required for D6

- `GET /healthz` returns edge liveness without waking the Container.
- `GET /.well-known/oauth-protected-resource` returns the expected resource, issuer, and scope.
- `/readyz` is not publicly routable.
- MCP initialize and `tools/list` work over the deployed HTTPS endpoint.
- Missing, malformed, expired, wrong-issuer, wrong-audience, wrong-algorithm, and insufficient-scope tokens are rejected; a valid provider-issued token can call each read-only tool.
- Untrusted Origin is rejected when an Origin allowlist is configured; the observed trusted client Origin succeeds.
- JWKS retrieval succeeds only for the configured exact URL; redirects and other destinations remain blocked.
- Container cold start, restart, inactivity, request limits, logs, and real billing/usage are reviewed.
- No user project files are accessible; the demo remains pinned to `/app/demo-project`.

### D5 boundary

D5 implementation does not perform account discovery, account mutation, billing changes, secret configuration, resource creation, or deployment. Those actions require separate explicit approval. D6 live OAuth/ChatGPT certification cannot begin until the public HTTPS endpoint and real external provider configuration exist.

## Phase 3.8 browser integration contract

The static Pages dashboard now contains an MCP browser client based on the official `@modelcontextprotocol/client` SDK. The browser flow is Authorization Code with PKCE; it does not use a client secret or dynamic client registration.

### Pages build-time configuration

- `VITE_MCP_ENDPOINT`: exact public HTTPS MCP endpoint ending in `/mcp`. HTTP is accepted only for local loopback development.
- `VITE_OAUTH_CLIENT_ID`: public client identifier for the pre-registered Auth0 Single Page Application. This value is not a secret. Never define a `VITE_*_CLIENT_SECRET`.

These values are build-time frontend configuration. They are not automatically inferred from Worker settings. The Pages build must be configured separately by the account owner; no Cloudflare project settings were changed by Phase 3.8.

### Auth0 public-client setup

Before enabling browser connectivity, the owner must configure the Auth0 application as a Single Page Application with:

1. Authorization Code grant and PKCE (S256); no client secret in the browser.
2. Allowed Callback URL equal to the production dashboard URL `https://react-review-ai.pages.dev/` (or the exact preview URL when validating a preview build).
3. Allowed Web Origin equal to `https://react-review-ai.pages.dev` (and the exact preview origin only when preview testing is intended).
4. API audience equal to the exact MCP resource URL, including `/mcp`.
5. The `review:read` API permission and RS256/ES256 access-token signing compatible with the resource server.
6. Auth0 CORS/allowed origins for `https://react-review-ai.pages.dev`, as required by the tenant configuration.
7. Enable **Resource Parameter Compatibility Profile** in Auth0 Dashboard → Settings → Advanced. The MCP SDK sends the RFC 8707 `resource` parameter; without this profile Auth0 can fall back to the userinfo audience instead of the configured API audience. See [Auth0's MCP audience guidance](https://support.auth0.com/center/s/article/mcp-audience-error-with-auth0).

The SDK performs protected-resource and authorization-server metadata discovery, validates issuer binding, handles the PKCE code exchange, and reconnects using a fresh Streamable HTTP transport. Callback `state` is checked before code exchange. Callback error descriptions are never rendered.

### Browser storage and CORS

- Access and refresh tokens are held in memory only and are not written to `localStorage` or `sessionStorage`.
- The PKCE verifier, OAuth state, and non-secret discovery metadata are stored in `sessionStorage` only to survive the authorization redirect; the transaction expires after 10 minutes and is cleared after callback processing.
- The Worker allows only explicit HTTPS Origins listed by hostname in `MCP_ALLOWED_ORIGIN_HOSTS`; wildcard Origins are not supported. For the verified production Pages site, the expected hostname entry is `react-review-ai.pages.dev` (hostname only, with no scheme or port).
- CORS preflight permits the MCP SDK request headers, including `Mcp-Method` and `Mcp-Name`, and exposes the authentication and protocol response headers needed by the browser client.
- For browser `tools/call` requests, missing/invalid bearer tokens return HTTP `401` and insufficient scope returns HTTP `403`, preserving `WWW-Authenticate` so the official MCP SDK can start or renew authorization. Non-browser hosts without an Origin retain the existing MCP-level authentication challenge behavior.

### Phase 3.8 validation boundary

Source-level and CI tests do not establish live browser authentication. The actual flow remains unverified until the owner configures the Pages build variables, registers the exact callback/origin in Auth0, configures the matching Worker issuer/JWKS/resource audience and trusted Origin, and deploys the backend under a separately approved plan. No backend deployment, Cloudflare account change, Auth0 tenant mutation, or billing change is included in Phase 3.8.