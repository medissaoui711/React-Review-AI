# Phase D5 — Deployment Readiness & Owner-Controlled Launch Preparation

Status: approved implementation scope; account changes and deployment are explicitly excluded.
Base commit: `ec0d7a09d0f8fc8d893cfc2ac73cbb656eee91d4`
Implementation branch: `phase-demo-cloudflare-d5-deployment-readiness`
Target: Cloudflare Workers with the default `workers.dev` hostname; no custom domain.

## Objectives

1. Correct the stale public-route documentation: `/readyz` is internal to the Durable Object/Container and is not exposed by the Worker.
2. Document account-owner checks for Workers Paid, Containers eligibility, limits, pricing, and workers.dev availability without changing account state.
3. Freeze the provider-neutral OAuth configuration contract, including exact resource audience alignment.
4. Document the manual deployment sequence and post-deployment acceptance evidence.
5. Extend branch CI to validate D5 changes while keeping Cloudflare build non-deploying.
6. Preserve the existing architecture, fixed demo root, read-only behavior, and all D4 security boundaries.

## Implementation scope

- Update `docs/phase-demo-cloudflare.md` with accurate route behavior, account eligibility/cost gates, OAuth issuer/JWKS/audience contract, safe configuration guidance, and the separately approved deployment sequence.
- Add this frozen D5 specification.
- Add regression assertions for documentation correctness and the no-deploy boundary.
- Add the D5 branch to the MCP CI push trigger.
- Keep `cf build` as build-only validation. No deployment command may be added to CI.

## Account and billing gate

The account owner must verify in the Cloudflare dashboard:
- Intended account access and identity.
- Workers Paid and Containers product eligibility.
- Current resource limits, regional availability, included usage, and overage pricing.
- Availability of the selected `workers.dev` subdomain.
- Cost acceptance based on current official Cloudflare pricing documentation.

The repository cannot establish account-specific eligibility or billing state. No plan upgrade or billing mutation is included.

## OAuth contract

- Remain provider-neutral; no identity provider is selected by the implementation.
- `OAUTH_ISSUER_URL` must exactly match the issuer claim.
- `OAUTH_JWKS_URL` must be an HTTPS endpoint accepted by the exact-URL JWKS egress guard.
- Tokens must use RS256 or ES256 and contain valid `iss`, `sub`, `aud`, and `exp`.
- Audience must equal the canonical public MCP resource URL ending in `/mcp`, derived from the deployed Worker origin.
- Scope defaults to `review:read`.
- Do not guess ChatGPT Origin. Configure `MCP_ALLOWED_ORIGIN_HOSTS` only after observing and verifying actual client behavior.
- No access tokens, client secrets, private keys, or Cloudflare API tokens may enter source control or logs. The resource server does not require a client secret.

## Validation

- Static tests assert the corrected public route contract and owner-controlled deployment boundaries.
- CI runs syntax checks, full regression tests, Cloudflare build, MCP STDIO/HTTP integration, and security/supply-chain checks.
- CI must not run `cf deploy`.
- PR validation must pass before requesting owner review.
- Do not claim account readiness, live OAuth, ChatGPT interoperability, or production certification without external evidence.

## Explicit exclusions

- No Cloudflare account authentication or account inspection.
- No account settings, Workers Paid plan, billing, quota, or subdomain changes.
- No Cloudflare resources or secrets/variables created or changed.
- No OAuth provider selection or provider-specific authorization-server implementation.
- No deployment, including `cf deploy`.
- No `main` modification or merge without a separate owner review and explicit approval.
- No D6 live certification until a public HTTPS endpoint and real provider configuration are available.

## Acceptance

D5 is complete when the branch contains the approved documentation/test/CI changes, all local and GitHub CI checks pass, the PR targets `main`, and the PR remains open for owner review. Deployment and account gates remain pending.
