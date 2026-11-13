# Phase D6 — Auth0 Production Certification Specification

**Status:** Frozen specification — approved Auth0 provider  
**Target branch:** `phase-d6-auth0-production-certification`  
**Base commit:** `9eb8b6b8eff0962df3cfed52870c605872537ad2`  
**Deployment target:** Cloudflare Workers + Containers on `workers.dev`  
**Authorization provider:** Auth0 (provider choice approved by repository owner)

## 1. Objective

Certify React Review AI as a production-capable, remotely accessible, OAuth-protected MCP service, and validate the complete connection from ChatGPT using Auth0-issued user-delegated access tokens.

This phase is gated. Passing repository CI or local protocol tests does not constitute production certification. Certification requires live tests against the deployed HTTPS endpoint and the real Auth0 tenant.

## 2. Frozen architecture

- Keep the existing Node.js HTTP MCP server and its four read-only tools.
- Keep the Cloudflare Worker edge, Durable Object-managed Container, fixed demo project, and dedicated JWKS egress design from D1–D5.
- Keep `workers.dev`; do not introduce a custom domain.
- Auth0 is the sole selected OAuth/OIDC authorization server for this certification.
- The MCP server remains an OAuth Resource Server. Auth0 owns login, consent, authorization-code issuance, refresh-token lifecycle, and client registration.
- Use Authorization Code + PKCE S256 with a public client registration through Auth0's MCP/CIMD support. Prefer CIMD over DCR when the tenant's discovery metadata and configuration confirm support. Do not embed a client secret in the repository or Worker.
- Use the canonical resource identifier `https://<workers-dev-host>/mcp`. The exact same value must appear as the protected resource metadata `resource`, Auth0 API identifier/audience, and access-token `aud`.
- Use the Auth0 issuer exactly as published by the tenant's discovery document, including its canonical trailing slash.
- Obtain JWKS from the tenant's published `jwks_uri`; configure only that exact HTTPS URL for the existing restricted JWKS egress.
- Require the existing `review:read` scope for all four review tools.
- Require signed JWT access tokens using RS256; reject opaque, encrypted, wrong-issuer, wrong-audience, expired, or insufficient-scope tokens.
- Preserve the existing public MCP discovery/initialization behavior and per-tool OAuth security metadata. Actual tool execution remains protected.
- Require refresh-token capability for durable ChatGPT connections; request `offline_access` only where Auth0 discovery and tenant policy support it.

## 3. Environment contract

Runtime configuration is supplied only through Cloudflare Worker/Container environment bindings or secrets after separate owner approval. Names and values must never be committed.

| Setting | Required value |
|---|---|
| `OAUTH_ISSUER_URL` | Exact Auth0 discovery `issuer` |
| `OAUTH_JWKS_URL` | Exact Auth0 discovery `jwks_uri` |
| `MCP_PUBLIC_URL` | Canonical HTTPS resource ending in `/mcp` |
| `OAUTH_REQUIRED_SCOPE` | `review:read` |
| `MCP_ALLOWED_ORIGIN_HOSTS` | Exact observed client origins only; never guessed |
| `MCP_HTTP_ALLOW_REMOTE` | `true` only for the approved production topology |
| `MCP_TRUST_PROXY_TLS` | `true` only behind the configured Cloudflare TLS edge |

No tenant domain, client identifier, secret, token, private key, or account identifier is to be invented or copied into source. Public issuer/JWKS/resource URLs may be documented only after the owner supplies or confirms them.

## 4. Auth0 tenant configuration gate (owner-controlled)

The implementation documentation and tests must specify the following owner-controlled Auth0 setup. No Auth0 dashboard changes are performed by this phase without a separate explicit approval.

1. Create or select a dedicated Auth0 tenant for this MCP integration.
2. Create an Auth0 API whose Identifier is exactly the final canonical MCP resource URL ending in `/mcp`.
3. Configure RS256 signed JWT access tokens and define the `review:read` API permission.
4. Enable Auth0's supported MCP/CIMD client registration path and register ChatGPT's actual CIMD metadata URL if required by the tenant's chosen flow.
5. Grant the ChatGPT client user-delegated access to only `review:read`; do not grant client-credentials or unrelated API permissions.
6. Ensure Authorization Code + PKCE S256, refresh-token support, and `offline_access` are available as supported by the tenant.
7. Confirm Auth0 discovery metadata, including issuer, authorization endpoint, token endpoint, JWKS URI, supported PKCE method, supported client authentication method, and CIMD/DCR capability.
8. Add the exact callback URL displayed by the ChatGPT MCP connection UI. Never guess or hard-code a callback URI.
9. Validate that the Auth0-issued access token contains the expected issuer, audience/resource, expiry, subject, and `review:read` scope.
10. Treat Auth0 Resource Parameter Compatibility Profile as a fallback diagnostic only. Auth0's native MCP resource-identifier support is preferred; do not enable compatibility toggles without separate owner approval and evidence that the native flow is unavailable.

## 5. Execution work packages and gates

### D6.1 — Account and deployment eligibility

- Recheck Cloudflare Workers Paid / Containers eligibility, plan limits, and workers.dev availability.
- Current audit result: account identity and workers.dev subdomain are readable; the Containers API returned an authorization error explicitly stating Workers Paid is required. Billing subscription details could not be read because the connected authorization lacks Billing Read.
- Gate passes only when the account owner confirms the required plan and current limits. No billing upgrade or account setting change is included.

### D6.2 — Auth0 integration readiness

- Implement or refine provider-neutral JWT/resource-server behavior only where tests reveal a real compatibility gap.
- Add Auth0-specific configuration and operational documentation without tenant credentials.
- Validate discovery metadata and JWT verification with deterministic fixtures; do not contact a live tenant until its public issuer/JWKS URLs are owner-confirmed.
- Ensure tool-level OAuth security schemes continue to match the runtime authorization requirement.
- No Auth0 tenant setup, client registration, secrets, or dashboard changes without separate approval.

### D6.3 — Controlled Cloudflare deployment

- Prepare a reviewed deployment checklist and exact binding/secret inventory.
- Create resources, configure bindings/secrets, and deploy only after separate explicit approval for each relevant Cloudflare operation.
- Deploy only to the already selected workers.dev target.
- No custom domain, public anonymous tool access, or automatic CI deployment.

### D6.4 — Live ChatGPT and MCP certification

- Confirm public HTTPS liveness, protected-resource metadata, and correct Auth0 discovery.
- Verify MCP initialize and tools/list, followed by all four tool calls with a real ChatGPT-issued Auth0 access token.
- Negative tests: missing token, malformed token, invalid signature, wrong issuer, wrong audience/resource, expired token, missing scope, revoked/rotated credentials, and JWKS outage.
- Verify 401/403 behavior and the `WWW-Authenticate` resource metadata challenge.
- Verify refresh/re-authorization, cold start, rate limiting, body-size limits, origin/host restrictions, and read-only file boundaries.
- No claims of ChatGPT production compatibility until the real connection and calls succeed.

### D6.5 — Release certification

- Publish a concise evidence-based report with commit SHA, deployment identifier/URL, workflow run links, Auth0 discovery evidence (no secrets), positive/negative test results, operational limits, unresolved risks, and a final Ready / Not Ready decision.
- A release/tag is not created unless separately approved.

## 6. Acceptance criteria

D6 is complete only when all are true:

1. Cloudflare Containers eligibility and plan limits are confirmed by the owner.
2. The reviewed branch passes MCP CI, Cloudflare build, tests, security workflow, dependency review, and required static checks.
3. Auth0 discovery and CIMD/public-client registration are proven compatible with the actual ChatGPT connection flow.
4. The resource identifier is preserved through authorization and token exchange and is validated as the access-token audience.
5. RS256 signature, exact issuer, exact audience, expiry, subject, and required scope are enforced.
6. Refresh/re-authorization works without storing credentials in source or logs.
7. All four tools work from ChatGPT only with authorized access and remain read-only.
8. Negative security tests and edge/runtime resilience tests pass.
9. Owner has explicitly approved deployment and each account/secret mutation before those actions occur.
10. Production evidence is recorded and no critical/high unresolved security issue remains.

## 7. Explicit exclusions and safety boundaries

- No changes to `main` until the owner reviews the PR and separately approves merge.
- No change to repository visibility, branch protection, or other repository settings.
- No Cloudflare resource creation/deletion, billing or plan changes, Workers account setting changes, workers.dev setting changes, secrets, environment bindings, or deployment without separate explicit approval.
- No Auth0 tenant creation, dashboard configuration, API/client registration, user creation, or secret configuration without separate explicit approval.
- No real credentials, access tokens, refresh tokens, private keys, client secrets, or sensitive account data in GitHub, CI logs, source, or documentation.
- No automatic deployment from CI.
- No write-capable MCP tools or modifications to user project files.
- No assumption that a successful local test, build, or CI run proves live production readiness.

## 8. Current baseline evidence

- Main SHA: `9eb8b6b8eff0962df3cfed52870c605872537ad2`.
- Repository visibility: public; unchanged.
- D1–D5 are merged.
- Latest inspected post-D5 MCP CI run: `43427292745`, success.
- Latest inspected post-D5 Security and Supply Chain run: `43427292480`, success. Dependency Review was skipped on push, as expected.
- No Worker script was returned by the Cloudflare account's read-only Worker listing.
- The account's workers.dev subdomain is present, but no production Worker URL has been established.
- Containers API access was denied with a Workers Paid requirement; billing entitlement remains unverified.
- No production deployment exists at the time this specification was frozen.

## 9. Reference documentation

- OpenAI MCP authentication: https://developers.openai.com/plugins/build/auth
- OpenAI custom MCP server setup: https://developers.openai.com/plugins/deploy/submission
- Auth0 Auth for MCP GA: https://auth0.com/blog/auth0-auth-for-mcp-servers-generally-available/
- OpenAI authenticated MCP scaffold / Auth0 setup: https://github.com/openai/openai-mcpkit/tree/main/python-authenticated-mcp-server-scaffold
- Cloudflare Containers pricing: https://developers.cloudflare.com/containers/platform/pricing/
- Cloudflare Workers pricing: https://developers.cloudflare.com/workers/platform/pricing/
