# React Review AI

Read-only React code review MCP server with local STDIO and Streamable HTTP transports.

## Requirements

- Node.js 22+
- npm

## Configure the trusted project root

Set `REACT_REVIEW_ROOT` to the absolute path of the one React project the server is authorized to inspect **before starting the MCP server**.

Linux/macOS:

```bash
REACT_REVIEW_ROOT=/absolute/path/to/react-project npm start
```

PowerShell:

```powershell
$env:REACT_REVIEW_ROOT = "C:\absolute\path\to\react-project"
npm start
```

The server resolves and validates this directory once per server instance. If the variable is missing, relative, inaccessible, or not a directory, startup fails closed. All four tools share this fixed root; callers cannot supply or override it.

## MCP transports

### STDIO (local integrations)

```bash
REACT_REVIEW_ROOT=/absolute/path/to/react-project npm start
```

### Streamable HTTP (local-only)

```bash
REACT_REVIEW_ROOT=/absolute/path/to/react-project npm run start:http
```

The HTTP transport listens on `127.0.0.1` by default and exposes `http://127.0.0.1:3000/mcp`. Set `PORT` to change the port. It uses the official MCP `createMcpHandler` entry with stateless request handling; each request receives a fresh MCP server instance and no protocol session is retained.

The endpoint validates `Host` and any supplied `Origin`, accepts POST requests only, and rejects standalone GET and DELETE session operations. Local-only mode remains available for trusted local integrations. When OAuth is configured, every MCP HTTP request requires a valid bearer token with the configured review scope. Remote binding is denied unless explicitly enabled and configured behind a TLS-terminating reverse proxy.


## HTTP OAuth resource-server configuration

React Review AI acts only as an OAuth **resource server**; it does not issue tokens, host a login page, store passwords, or implement an authorization server. Configure a trusted external OAuth 2.1 / OpenID Connect provider that issues signed JWT access tokens and publishes a JWKS endpoint.

Required variables when OAuth is enabled:

- `OAUTH_ISSUER_URL` — exact issuer identifier from the identity provider.
- `OAUTH_JWKS_URL` — HTTPS JWKS endpoint published by that issuer.
- `MCP_PUBLIC_URL` — canonical HTTPS resource URL ending in `/mcp`, also used as the required token audience.
- `OAUTH_REQUIRED_SCOPE` — optional; defaults to `review:read`.

Example local environment configuration (use real provider values):

```bash
OAUTH_ISSUER_URL=https://identity.example.com/
OAUTH_JWKS_URL=https://identity.example.com/.well-known/jwks.json
MCP_PUBLIC_URL=https://mcp.example.com/mcp
OAUTH_REQUIRED_SCOPE=review:read
REACT_REVIEW_ROOT=/absolute/path/to/react-project
npm run start:http
```

The resource server validates the JWT signature using remote JWKS, pins accepted algorithms to RS256/ES256, validates exact issuer, audience, subject and expiry, and requires the configured scope. It publishes RFC 9728 Protected Resource Metadata at `/.well-known/oauth-protected-resource` and advertises it in bearer challenges. Access tokens are accepted only from the configured issuer and only for this MCP resource. Tokens must be sent in the `Authorization: Bearer` header, never in query parameters.

### Explicit remote deployment

The default bind remains `127.0.0.1`. To bind to a non-loopback interface, all of the following are required:

- `MCP_HTTP_HOST` set to the intended private interface or `0.0.0.0`.
- `MCP_HTTP_ALLOW_REMOTE=true`.
- Complete OAuth configuration above, with HTTPS issuer, JWKS and public resource URLs.
- `MCP_TRUST_PROXY_TLS=true` to explicitly declare that a trusted TLS-terminating reverse proxy is in front of the process.

Example:

```bash
MCP_HTTP_HOST=127.0.0.1
MCP_HTTP_ALLOW_REMOTE=true
MCP_TRUST_PROXY_TLS=true
```

Prefer keeping the MCP process bound to loopback and exposing it only through a reverse proxy. If a non-loopback bind is necessary, restrict network access to the proxy with firewall rules; do not expose the plain HTTP listener directly to the Internet. The application cannot independently prove that an external proxy is enforcing TLS, so deployment configuration and network controls remain an operator responsibility.

### HTTP resource protections

- `Host` and `Origin` allowlists remain enforced.
- Bearer tokens and authorization headers are never written to application logs.
- Request bodies are limited to 1 MiB by default.
- Requests are rate-limited to 120 per token fingerprint per minute by default; set `MCP_RATE_LIMIT_PER_MINUTE` to change this positive integer.
- HTTP headers, header wait time and request timeout have explicit limits.
- STDIO remains local and does not use HTTP OAuth; it continues to use the trusted `REACT_REVIEW_ROOT` environment variable.
- Use short-lived access tokens and the identity provider's revocation controls. Local JWT verification does not provide immediate per-token revocation before token expiry.

## MCP tools

- `review_project`
- `review_component` — accepts only a project-relative `file_path`
- `run_test_audit`
- `audit_accessibility`

## Skills

- React code review
- React testing
- Accessibility audit (WCAG 2.2)

The server performs static, read-only analysis. It does not modify project files, execute project code or tests, calculate actual test coverage, or claim WCAG conformance.

## Validation

GitHub Actions syntax-checks the server modules, runs security/regression and HTTP transport tests, negotiates MCP over STDIO and Streamable HTTP, verifies that no tool exposes a project-root override, and calls each registered tool over both transports.

## AST analysis and result contracts

The review engine parses JavaScript, JSX, TypeScript, and TSX into an AST before applying syntax-aware rules. Parse failures are reported separately and are not silently converted into findings. Finding IDs are deterministic for the same rule, file, source location, and evidence. Each finding includes a rule ID, severity, category, confidence, file location, evidence, explanation, recommendation, and verification guidance.

The project scan enforces these default resource budgets: 2,500 discovered files, 500 KB per source file, 20 MB total source bytes, 10 seconds per scan, and 5,000 findings. Results report truncation, timeout, skipped files, and parse errors. These are safety ceilings, not performance guarantees.

Each MCP tool publishes a dedicated structured output contract. The text response remains available for clients that do not consume structured content. Static rules are signals for human review; they do not prove runtime exploitability or accessibility conformance.
