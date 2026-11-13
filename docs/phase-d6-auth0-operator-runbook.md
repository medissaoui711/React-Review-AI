# Phase D6 — Auth0 Operator Runbook

This runbook is for the repository owner. It documents the Auth0-side configuration required for the already implemented OAuth Resource Server. It does not perform or authorize changes in Auth0 or Cloudflare.

## Intended public resource

The Worker name in `cloudflare.config.ts` is `react-review-ai-demo`. The connected Cloudflare account's existing workers.dev subdomain was read as `contacteinfo71`.

The expected endpoint after deployment is:

```text
https://react-review-ai-demo.contacteinfo71.workers.dev/mcp
```

This URL is a deployment target derived from the current Worker name and account subdomain, not proof that a Worker is deployed or reachable. Confirm the final URL in Cloudflare after the owner approves deployment. If Cloudflare reports a different hostname, stop and update the API identifier, protected-resource metadata, token audience, and tests together before deployment.

## Auth0 configuration checklist

Complete these steps in the Auth0 Dashboard only after separately approving Auth0 tenant changes:

1. Select a dedicated Auth0 tenant. Do not use an existing production tenant without reviewing its policies and grants.
2. Create an API named `React Review AI MCP`.
3. Set its Identifier to the exact final MCP resource URL, including `/mcp`. Do not use the Auth0 tenant's `/userinfo` audience.
4. Set the signing algorithm to `RS256`.
5. Add the API permission `review:read`. Do not create write permissions.
6. Enable the Auth0 Auth for MCP / CIMD registration capability supported by the tenant. Prefer the native Auth0 MCP resource-identifier support; do not enable legacy Resource Parameter Compatibility Profile unless a verified compatibility issue requires it and the owner separately approves the setting.
7. Register ChatGPT using the CIMD metadata URL shown by the actual ChatGPT MCP connection flow / management interface. Do not guess the callback URI or copy a callback from another connection.
8. Authorize only the `review:read` scope for this client. Use user-delegated Authorization Code flow with PKCE S256. Do not enable client-credentials or machine-to-machine access for this MCP connection.
9. Ensure refresh-token support is enabled for the authorization-code client and that the required `offline_access` scope is available if ChatGPT requests it. Apply rotation/reuse detection according to the tenant's supported refresh-token policy.
10. Confirm the tenant discovery document advertises the actual issuer, authorization endpoint, token endpoint, JWKS URI, PKCE S256, CIMD capability and accepted token endpoint authentication method.
11. Confirm that access tokens are signed JWTs using RS256 and contain the exact MCP API identifier in `aud`, the canonical tenant issuer in `iss`, a non-empty `sub`, a valid `exp`, and `review:read` in `scope`.
12. Record only non-secret issuer and JWKS URLs for the later Cloudflare configuration approval. Never place client secrets, access/refresh tokens, private keys, or user credentials in this repository.

## Cloudflare runtime variables (separate approval required)

| Name | Value source |
|---|---|
| `OAUTH_ISSUER_URL` | Exact `issuer` from Auth0 discovery, including trailing slash |
| `OAUTH_JWKS_URL` | Exact `jwks_uri` from Auth0 discovery |
| `MCP_PUBLIC_URL` | Final canonical public MCP URL ending in `/mcp` |
| `OAUTH_REQUIRED_SCOPE` | `review:read` |
| `MCP_ALLOWED_ORIGIN_HOSTS` | Exact origin hostname observed during a real ChatGPT connection; no guessed values |

The Container receives these values through the existing Worker-to-Container environment forwarding. The JWKS egress Worker permits only the exact configured HTTPS URL and GET requests. Do not broaden its destination allowlist.

## Discovery and token acceptance checks

Before attempting a live ChatGPT connection, verify the following from the real Auth0 tenant:

- `/.well-known/openid-configuration` is reachable over HTTPS.
- The discovery `issuer` exactly matches `OAUTH_ISSUER_URL`.
- The discovery `jwks_uri` exactly matches `OAUTH_JWKS_URL`.
- The authorization server supports Authorization Code and PKCE S256.
- The chosen CIMD client registration is accepted and the exact ChatGPT callback URI is allowlisted.
- The `resource` value is preserved through authorization and token exchange.
- The issued access token audience contains the exact MCP API identifier.
- The access token is an RS256 JWT and includes `review:read`.

Do not paste tokens into tickets, chat, logs, screenshots, or source control. If a token must be inspected locally, decode it only in a trusted local environment and redact all personal and credential-bearing claims from any evidence.

## Stop conditions

Stop before deployment or live certification if:

- The actual workers.dev hostname differs from the documented target.
- Auth0 emits an opaque/encrypted token, wrong issuer/audience, or no `review:read` scope.
- The Auth0 tenant cannot support the chosen ChatGPT CIMD flow and PKCE S256.
- The ChatGPT callback URI is not explicitly displayed by the actual connection UI.
- Cloudflare Containers remains unavailable because Workers Paid eligibility is not confirmed.
- The observed ChatGPT Origin cannot be established safely.

A successful local fixture test is not evidence of a live Auth0 or ChatGPT integration.
