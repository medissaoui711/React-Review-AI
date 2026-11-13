# Phase 3.6 — Provider-neutral OAuth compatibility

React Review AI is an OAuth resource server, not an authorization server. It verifies access tokens issued by an external identity provider and intentionally does not implement login, authorization-code exchange, client registration, or refresh-token storage.

## Provider acceptance contract

A candidate provider must be validated against the following capabilities before a ChatGPT connection is considered deployable:

- OAuth 2.1 Authorization Code flow with PKCE using S256.
- Authorization Server Metadata (RFC 8414) with exact issuer identity.
- Client ID Metadata Documents (CIMD) or Dynamic Client Registration (DCR).
- Authorization and token requests preserve the MCP `resource` indicator (RFC 8707).
- The issued access token is audience-bound to the exact configured MCP resource URL.
- JWT access tokens use RS256 or ES256 and expose a JWKS endpoint.
- Access tokens include issuer, subject, audience, expiry, and the required `review:read` scope.
- Refresh-token issuance and rotation are supported when `offline_access` is requested.
- Authorization responses include the exact issuer (`iss`) when the provider advertises issuer identification.

## Validation boundary

The automated provider simulator exercises discovery, DCR, PKCE S256, resource binding, access-token verification, and refresh-token rotation. It is a protocol-contract test, not proof that a named commercial identity provider or ChatGPT has completed a live OAuth connection.

A production validation still requires a real provider tenant, HTTPS public MCP endpoint, configured redirect URI/client registration, and a connection test from ChatGPT's MCP settings. Until those are available, the repository must report live ChatGPT OAuth validation as pending.


## MCP Inspector CLI validation note

The official MCP Inspector CLI v2.14.0 was evaluated in CI with `--protocol-era modern`. Its pinned `server/discover` negotiation did not recognize the modern revision offered by this server, while the official MCP TypeScript SDK Client 2.4.0 successfully negotiated the same modern revision in pinned mode over both STDIO and Streamable HTTP and completed all tool calls. To avoid a false CI failure, the Inspector CLI step is not treated as a release gate for this PR; automated protocol verification uses the official SDK client with an explicit modern-era assertion. A manual Inspector UI/CLI interoperability pass remains a follow-up validation item.
