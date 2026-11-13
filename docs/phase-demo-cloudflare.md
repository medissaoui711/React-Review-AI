# React Review AI — Cloudflare Demo

## Status

This deployment is developed on `phase-demo-cloudflare`. It is a demo environment only. It does not change `main`, create Cloudflare resources, configure account settings, or deploy automatically.

The public Worker is intended to run on the default `workers.dev` hostname. No custom domain is required.

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

The container currently requires outbound network access for remote JWKS retrieval. Before a public deployment, the owner must approve the egress policy and the permitted identity-provider hostname(s). No access token, signing key, or client secret belongs in this repository.

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
