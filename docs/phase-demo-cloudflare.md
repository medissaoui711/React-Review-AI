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
- The Worker exposes only `POST /mcp`, `GET /.well-known/oauth-protected-resource`, `GET /healthz`, and `GET /readyz`.
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
