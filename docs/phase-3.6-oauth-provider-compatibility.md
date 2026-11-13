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


## MCP Inspector CLI validation

The official MCP Inspector CLI v2.14.0 is now a blocking CI compatibility check on both transports. CI invokes it with `--protocol-era modern`, asserts that `tools/list` returns all four registered tools, and passes the trusted `REACT_REVIEW_ROOT` explicitly to the STDIO child process with Inspector's `-e` option. The HTTP check targets the live local Streamable HTTP endpoint.

The earlier STDIO negotiation failure was caused by the diagnostic child process starting without the required `REACT_REVIEW_ROOT`, not by a protocol-version mismatch. Supplying the environment variable fixed the CLI test. A separate raw-wire regression test also verifies that `resultType`, `supportedVersions`, and server identity metadata are nested under the JSON-RPC `result` object as required by the 2026-07-28 discovery schema.

Verified in [MCP CI run 290](https://github.com/medissaoui711/React-Review-AI/actions/runs/43396201668): Inspector modern STDIO and HTTP checks passed. The Inspector Web UI has not yet had a manual interactive validation pass. Inspector strict schema checks report zero errors; remaining warnings concern nullable JSON Schema type arrays, which are valid under JSON Schema 2020-12 but less portable to some non-JSON-Schema provider dialects.
