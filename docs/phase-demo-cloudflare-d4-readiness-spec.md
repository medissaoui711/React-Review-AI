# Phase D4 — Cloudflare & OAuth Readiness

Status: approved implementation scope; deployment remains out of scope.

Base commit: `094bc4b3c95e9e55354cb0481dc8f589887694c4`
Implementation branch: `phase-demo-cloudflare-d4-readiness`

## Goals

1. Keep non-MCP public endpoints at the Worker edge so health checks and OAuth discovery do not wake the Durable Object or Container.
2. Restrict Container egress interception to the exact configured JWKS HTTPS URL.
3. Verify Origin behavior for browser clients and non-browser clients without assuming a ChatGPT Origin value.
4. Run the full MCP/Cloudflare build workflow on pushes to `main`, while retaining PR validation.
5. Preserve provider-neutral OAuth, read-only review behavior, fixed demo project root, and the no-deploy boundary.

## Implementation requirements

### Worker routing
- `GET /healthz` returns edge liveness with `Cache-Control: no-store`.
- `GET /.well-known/oauth-protected-resource` returns RFC 9728 resource metadata at the edge, derived from the request origin and configured issuer/scope.
- `POST /mcp` is the only public route forwarded to the Durable Object.
- `/readyz` is not a public Worker route. It remains an internal Container probe only.
- Unknown routes return 404; unsupported methods return 405 with `Allow`.

### JWKS egress
- Require HTTPS and GET.
- Reject configured JWKS URLs containing credentials or fragments.
- Require exact canonical URL equality, including hostname, port, path, and query.
- Keep redirects manual; do not follow a redirect to another destination.

### Origin behavior
- Continue to accept requests without an Origin header for non-browser MCP clients.
- Explicitly configured origin hostnames are accepted.
- Unconfigured browser origins are rejected.
- Do not hardcode or assume a ChatGPT Origin value; production configuration must be validated against the actual client behavior.

### CI and documentation
- Include `main` and the D4 branch in MCP CI push triggers.
- Keep Cloudflare build validation non-deploying.
- Document edge routing, JWKS restriction, Origin configuration, provider-neutral OAuth, and deployment/cost gates.
- Do not add automatic `cf deploy` steps.

## Validation gates

- Static contract tests cover Worker route boundaries, edge metadata/liveness, internal readiness probe, exact JWKS URL enforcement, and no-deploy CI.
- HTTP integration tests cover untrusted Origin rejection, configured Origin acceptance, and no-Origin client acceptance.
- GitHub Actions must pass on the D4 pull request, including Cloudflare build, MCP integration, regression/security tests, SBOM/license inventory, and CodeQL/Dependency Review where applicable.
- No claim of live OAuth/ChatGPT production certification without a deployed public HTTPS endpoint and a real provider configuration.

## Explicit exclusions

- No Cloudflare deployment or `cf deploy`.
- No Cloudflare account settings, resource creation, billing-plan changes, or secret configuration.
- No provider-specific OAuth implementation or identity-provider selection.
- No change to repository visibility or branch protection.
- No merge to `main` without owner review and explicit approval.
