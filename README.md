# React Review AI

Read-only React code review MCP server with local STDIO and Streamable HTTP transports.

## Requirements

- Node.js 22+
- npm

## Configure the trusted local project root

For local STDIO integrations, set `REACT_REVIEW_ROOT` to the absolute path of the one React project the local server is authorized to inspect **before starting the MCP server**. Authenticated HTTP deployments use uploaded, temporary per-user workspaces instead.

Linux/macOS:

```bash
REACT_REVIEW_ROOT=/absolute/path/to/react-project npm start
```

PowerShell:

```powershell
$env:REACT_REVIEW_ROOT = "C:\absolute\path\to\react-project"
npm start
```

STDIO validates this directory during server startup and fails closed if it is missing, relative, inaccessible, or not a directory. In local HTTP mode without OAuth, the same trusted root is used. In OAuth-enabled HTTP mode, users upload a ZIP archive to create an isolated temporary workspace; the verified token subject owns that workspace, and callers cannot supply a filesystem path or override the project root.

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

The endpoint validates `Host` and any supplied `Origin`, accepts POST requests only, and rejects standalone GET and DELETE session operations. Local-only mode remains available for trusted local integrations. When OAuth is configured, `initialize` and `tools/list` remain available without a token so clients can discover the tool catalog; each `tools/call` is independently verified against the configured issuer, audience, expiry, and review scope. Tool descriptors advertise OAuth security schemes, and unauthenticated or insufficient-scope tool results carry the `mcp/www_authenticate` metadata challenge used by ChatGPT to start or step up OAuth linking. STDIO remains local and keeps its existing trusted-environment behavior. Remote binding is denied unless explicitly enabled and configured behind a TLS-terminating reverse proxy.

### Health, readiness, and graceful shutdown

- `GET /healthz` returns a minimal liveness response (`200`) without exposing configuration or project details.
- `GET /readyz` verifies the configured local project root in non-OAuth mode, or the temporary workspace manager in OAuth mode, and returns `200` only when the relevant service is ready. Both endpoints enforce the same Host/Origin checks and use `Cache-Control: no-store`.
- Health endpoints accept GET only. They do not expose metrics, environment variables, file paths, or OAuth state.
- On SIGINT/SIGTERM, the HTTP server stops accepting new connections, closes idle connections, waits for active requests, and force-closes remaining HTTP connections after `MCP_SHUTDOWN_TIMEOUT_MS` (default `10000` ms). The timeout must be a positive integer.
- Liveness is not readiness: route traffic only when `/readyz` reports `ready`.


## HTTP OAuth resource-server configuration

React Review AI acts only as an OAuth **resource server**; it does not issue tokens, host a login page, store passwords, or implement an authorization server. Configure a trusted external OAuth 2.1 / OpenID Connect provider that issues signed JWT access tokens and publishes a JWKS endpoint.

Required variables when OAuth is enabled:

- `OAUTH_ISSUER_URL` — exact issuer identifier from the identity provider.
- `OAUTH_JWKS_URL` — HTTPS JWKS endpoint published by that issuer.
- `MCP_PUBLIC_URL` — canonical HTTPS resource URL ending in `/mcp`, also used as the required token audience.
- `OAUTH_REQUIRED_SCOPE` — optional; defaults to `review:read`.
- `MCP_ALLOWED_ORIGIN_HOSTS` — optional comma-separated browser origin hostnames, without schemes or ports.

Example local environment configuration (use real provider values):

```bash
OAUTH_ISSUER_URL=https://identity.example.com/
OAUTH_JWKS_URL=https://identity.example.com/.well-known/jwks.json
MCP_PUBLIC_URL=https://mcp.example.com/mcp
OAUTH_REQUIRED_SCOPE=review:read
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

Keep the MCP process bound to loopback and expose it only through a reverse proxy. Set `MCP_HTTP_HOST=0.0.0.0` only when the proxy must reach the process over a private network, and then restrict network access to the proxy with firewall rules; do not expose the plain HTTP listener directly to the Internet. The application cannot independently prove that an external proxy is enforcing TLS, so deployment configuration and network controls remain an operator responsibility.

### HTTP resource protections

- `Host` and `Origin` allowlists remain enforced; add trusted browser origins explicitly through `MCP_ALLOWED_ORIGIN_HOSTS`. Remote-bind mode starts without localhost aliases and allows only the configured resource host plus explicitly configured origins.
- Bearer tokens and authorization headers are never written to application logs.
- MCP request bodies are limited to 1 MiB by default. Authenticated workspace ZIP uploads have a separate 20 MB hard limit.
- Requests are rate-limited to 300 per socket peer per minute and 120 per token fingerprint per minute by default; set `MCP_RATE_LIMIT_PER_IP_PER_MINUTE` and `MCP_RATE_LIMIT_PER_MINUTE` respectively to change these positive integers. Behind a reverse proxy, the socket peer is the proxy, so enforce complementary per-client limits at the proxy.
- HTTP headers, header wait time and request timeout have explicit limits.
- `MCP_SHUTDOWN_TIMEOUT_MS` controls the bounded graceful-shutdown window (default 10 seconds).
- `MCP_MAX_CONCURRENT_REQUESTS` caps active non-health HTTP requests (default 4); excess requests receive `503` with `Retry-After: 1`. Liveness/readiness probes bypass this concurrency gate.
- STDIO remains local and does not use HTTP OAuth; it continues to use the trusted `REACT_REVIEW_ROOT` environment variable. OAuth-enabled HTTP analysis is bound to a temporary workspace owned by the verified JWT subject.
- Use short-lived access tokens and the identity provider's revocation controls. Local JWT verification does not provide immediate per-token revocation before token expiry.

## Provider-neutral OAuth compatibility

See [Phase 3.6 provider compatibility](docs/phase-3.6-oauth-provider-compatibility.md) for the external identity-provider contract, PKCE/resource requirements, refresh-token expectations, and the boundary between simulated tests and live ChatGPT validation.

## Authenticated project workspaces

OAuth-enabled HTTP deployments do not use a shared REACT_REVIEW_ROOT. Upload a ZIP archive to the same host as the MCP endpoint:

```bash
curl --fail-with-body \
  -X POST https://mcp.example.com/workspaces \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/zip" \
  --data-binary @project.zip
```

The response contains workspace_id and expires_at. Include workspace_id in the arguments to review_project, review_component, run_test_audit, and audit_accessibility. review_component also requires a workspace-relative file_path. Delete a workspace with DELETE /workspaces/{workspace_id}; only its authenticated owner can delete it.

ZIP intake is bounded to 20 MB compressed, 2,500 entries, 500 KB per file, and 20 MB expanded content. The service rejects traversal paths, absolute paths, duplicate paths, symlinks, special entries, encrypted archives, ZIP64, and multi-volume archives. Workspaces expire after 30 minutes and are limited to three active workspaces per user.

Workspace metadata is process-local and files live on the Node host's temporary filesystem. The current implementation is single-process only; a multi-instance deployment needs shared workspace storage/metadata or enforced single-instance routing. Process restarts invalidate workspace IDs. No uploaded source, package script, or test is executed.

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

## Release certification workflow

The manual workflow `.github/workflows/release-certification.yml` certifies an existing version tag, verifies that the tag matches `package.json`, runs syntax checks, the full automated test suite and dependency audit, then creates a source archive, CycloneDX SBOM, license inventory and SHA-256 manifest. It publishes a GitHub Release with generated release notes only when an authorized maintainer explicitly dispatches the workflow with a tag. No release or tag is created by Phase 3.7 implementation.

## Performance evidence

The MCP CI workflow runs a bounded synthetic project scan (100 JSX files, approximately 1 KB each) through the isolated AST worker. The MCP CI workflow also runs 100 concurrent-capable modern Streamable HTTP `tools/list` requests through the official MCP client (100 requests, concurrency 3), recording p50/p95/p99 latency, throughput, and errors. These local CI figures are regression signals only, not production capacity claims. It records Node version, OS/architecture, available CPU count, elapsed time, scanned bytes, findings, parse errors, timeout/truncation flags, RSS, and in-process metrics as a 30-day workflow artifact. The gate checks that the synthetic scan stays within the configured 10-second scan ceiling and completes without truncation or parse errors. This is a regression benchmark, not a production capacity claim; deployment-specific load/soak testing remains required.

## Production certification status

Repository settings, legal licensing choices, live OAuth/ChatGPT validation, MCP Inspector Web UI manual validation and deployment-level monitoring remain owner-controlled gates. The Inspector CLI v2.14.0 modern protocol checks pass on both STDIO and Streamable HTTP in CI; strict schema portability checks report zero errors and zero warnings. See the [Phase 3.7 certification matrix](docs/phase-3.7-certification-matrix.md) for evidence status and [owner actions](docs/phase-3.7-owner-actions.md) for the exact pending checklist. The implementation does not claim production certification until those external gates have evidence.

## HTTP observability and privacy

The HTTP transport writes one JSON log record per completed or aborted request to stderr. Each request receives a server-generated `X-Request-Id` response header. Logs contain only the request ID, HTTP method, a fixed low-cardinality route label, status code, and elapsed milliseconds. They do not include request URLs or query strings, client IP addresses, request/response bodies, cookies, Authorization headers, bearer tokens, or OAuth claims. Health endpoints return only minimal status and are not a metrics or diagnostics surface.

The HTTP runtime exposes a programmatic `getMetrics()` snapshot to its embedding process. It contains bounded route/status counters, request-duration buckets, rate-limit/overload counts, and analysis outcome/resource-budget counters without file paths or user-controlled labels. A public metrics endpoint is intentionally not exposed. Production metrics export, alert delivery, retention policy, and log aggregation still require deployment-level integration and an explicit access boundary; they are not claimed as completed by this repository workflow.

## Security and supply-chain automation

The `.github/workflows/security-supply-chain.yml` workflow provides:

- CodeQL analysis for JavaScript/TypeScript and GitHub Actions workflows.
- Pull-request dependency review that blocks newly introduced high or critical vulnerabilities.
- `npm audit` against the complete locked dependency tree.
- Dependency Review on pull requests; this check requires GitHub Dependency Graph to be enabled. It is currently blocked by the repository setting (see the Phase 3.7 owner-actions checklist).
- Zod is pinned to `4.6.7`; the initial high-severity advisory affecting `4.2.0` was fixed, and the latest security workflow reported zero vulnerabilities.
- A CycloneDX SBOM and a machine-readable license inventory generated from `package-lock.json`.
- Workflow artifacts containing the SBOM and license inventory, retained for 30 days.

GitHub Actions used by this workflow are pinned to verified full commit SHAs; Dependabot is configured to propose weekly dependency and Actions updates. The inventory reports missing license metadata as `UNKNOWN`; it does not make a legal compatibility determination. No project license has been selected or added. License policy and any exception require maintainer review. Passing scanners does not prove the absence of vulnerabilities.

## Validation

GitHub Actions syntax-checks the server modules, runs security/regression tests, negotiates MCP over STDIO and Streamable HTTP, verifies the tool-level OAuth metadata and authentication challenge, tests unauthenticated discovery and authenticated calls to all four tools against a simulated provider key set, verifies that no tool exposes a project-root override, and calls each registered tool over both transports.

## AST analysis and result contracts

The review engine parses JavaScript, JSX, TypeScript, and TSX into an AST before applying syntax-aware rules. Parse failures are reported separately and are not silently converted into findings. Finding IDs are deterministic for the same rule, file, source location, and evidence. Each finding includes a rule ID, severity, category, confidence, file location, evidence, explanation, recommendation, and verification guidance.

The project scan enforces these default resource budgets: 2,500 discovered files, 500 KB per source file, 20 MB total source bytes, 10 seconds per scan, and 5,000 findings. AST parsing runs in an isolated worker thread; the parent process enforces the remaining wall-clock budget and terminates the worker if parsing exceeds it. The single-file review uses the same worker boundary and a 10-second ceiling. Results report truncation, timeout, skipped files, and parse errors. Filesystem discovery and reads are asynchronous and checked against the scan deadline between operations; the worker timeout specifically prevents synchronous parser work from blocking the MCP event loop. These are safety ceilings, not performance guarantees.

Each MCP tool publishes a dedicated structured output contract. The text response remains available for clients that do not consume structured content. Static rules are signals for human review; they do not prove runtime exploitability or accessibility conformance.


## Cloudflare public demo

The Cloudflare demo implementation is maintained on the separate `phase-demo-cloudflare` branch. It uses a Cloudflare Worker, a Durable Object, and a Node.js 22 Container. The demo is configured for the default `workers.dev` hostname and scans only the fixed `demo-project/` fixture.

See [Cloudflare demo architecture, security boundaries, and deployment gates](docs/phase-demo-cloudflare.md).

The CI workflow builds the Cloudflare Worker/Container configuration but never deploys it. Cloudflare account authentication, OAuth issuer/JWKS configuration, egress policy, runtime secrets, and the final `cf deploy` command remain explicit owner-controlled steps. No Cloudflare resources are created by CI.
