# Phase 3.7 — Production Hardening & Release Certification
## Frozen implementation specification

**Status:** Approved for implementation by repository owner  
**Implementation branch:** phase-3.7-production-hardening  
**Base:** main at Phase 3.6 merge commit 8087b028dfc598ded19fc942a40b54680c87193f  
**Repository visibility:** Preserve current visibility (public); no visibility changes are in scope.  
**Protected integration rule:** Do not commit, push, merge, or otherwise modify main during this phase. All implementation changes must remain on this branch until a reviewed PR is explicitly approved by the owner.

## 1. Objectives and non-goals

Harden the repository, CI pipeline, runtime, OAuth integration, observability, performance controls, and release process so the project can be evaluated against measurable production-readiness gates.

Passing CI alone is not production certification. Live certification requires evidence from the actual deployment environment and a real OAuth/OIDC provider. If credentials, a public HTTPS endpoint, or operational infrastructure are unavailable, those gates must be reported as BLOCKED or NOT TESTED, never simulated as passed.

Preserve the product's read-only behavior:
- Never execute user project code, test scripts, package scripts, or build scripts as part of review tools.
- Never modify user project files.
- Keep project file access restricted to the configured trusted root.
- Keep STDIO and Streamable HTTP compatible with the currently supported MCP protocol revision.
- Keep OAuth provider-neutral.
- Never log access tokens, refresh tokens, authorization headers, secrets, or raw sensitive request bodies.

## 2. Work packages

### 3.7.1 Repository governance and source integrity
1. Verify repository identity, default branch, visibility, branch inventory, and current main SHA. Preserve visibility as-is.
2. Add justified repository guidance (SECURITY.md, CODEOWNERS, PR template and contribution notes).
3. Define a recommended main-branch protection policy: PR-only changes, required CI checks, conversation resolution, stale approval dismissal, and prohibition of force-push/deletion.
4. Do not mutate repository settings, branch protection, visibility, secrets, or environments without separate explicit owner authorization. Document exact settings and checks needed for owner activation.
5. Ensure generated dependency artifacts are deterministic and committed only to the triggering feature branch; verify CI cannot write to main from a feature-branch run.

### 3.7.2 Supply-chain and dependency security
1. Add Dependabot configuration for npm and GitHub Actions with bounded update cadence and sensible grouping.
2. Add dependency review on pull requests and a repeatable npm dependency audit gate.
3. Review direct/transitive dependencies, lockfile integrity, supported Node engine, and clean install behavior using npm ci.
4. Pin third-party GitHub Actions to verified full commit SHAs; document the upstream version corresponding to each pin.
5. Minimize workflow token permissions per job and use read-only permissions by default.
6. Define audit exceptions with package, advisory, rationale, owner, expiry date, and compensating control. No silent blanket ignores.

### 3.7.3 Security scanning, SBOM, and license compliance
1. Add CodeQL analysis for JavaScript/TypeScript and GitHub Actions where supported.
2. Enable or document secret scanning and push protection; never print discovered secret values.
3. Generate a release SBOM in SPDX or CycloneDX format from the locked dependency graph.
4. Add automated license inventory and policy checks; flag unknown, missing, or incompatible licenses for human review.
5. Upload security, SBOM, and license outputs as workflow artifacts and attach the release SBOM to the release.
6. Treat scanners as evidence sources, not proof of absence of vulnerabilities.

### 3.7.4 Runtime and deployment hardening
1. Audit environment parsing, fail-closed behavior, startup validation, and separation of test/development/production configuration.
2. Add explicit liveness/readiness behavior suitable for deployment without exposing secrets or project contents.
3. Verify graceful shutdown, active connection draining, server timeouts, request size limits, and error handling.
4. Review Host/Origin validation and trusted-proxy assumptions. Do not trust arbitrary forwarded headers; document exactly which proxy boundary is trusted and how client identity is conveyed.
5. Validate HTTPS termination, public URL/resource consistency, firewall exposure, and deployment topology using a real staging environment when available.
6. Provide deployment examples and a hardened environment-variable reference; never commit real secrets.
7. Keep loopback binding as the safe default. Remote binding remains explicit and requires OAuth plus HTTPS reverse-proxy configuration.

### 3.7.5 OAuth and token lifecycle
1. Preserve provider-neutral OAuth resource-server architecture.
2. Add integration coverage for authorization-server metadata discovery, DCR where supported, PKCE S256, RFC 8707 resource indicators, audience binding, scopes, expiry, and refresh-token rotation where applicable.
3. Add tests for key rotation, stale JWKS cache behavior, JWKS unavailability, malformed claims, clock-skew boundaries, and revoked/expired credentials where the provider exposes such behavior.
4. Verify bearer credentials and refresh tokens are never logged or persisted by this server.
5. Run a live integration against a real supported OAuth/OIDC provider and reachable HTTPS MCP endpoint only when the owner supplies/configures required provider and deployment credentials.
6. Attempt an actual ChatGPT connection/authorization flow when deployment is reachable and supported. Record exact outcomes. Simulator tests must be labelled as simulator tests, not live validation.

### 3.7.6 Observability, privacy, and operations
1. Introduce structured operational logs with request correlation IDs and bounded, sanitized fields.
2. Redact Authorization, cookies, token-like values, secrets, and sensitive payloads at source.
3. Add low-cardinality metrics for request counts, latency, status classes, tool names, rate-limit rejections, parse outcomes, and resource-budget exhaustion.
4. Do not expose metrics or diagnostic endpoints publicly without an explicit access boundary.
5. Document retention, access, and deletion expectations for operational logs.
6. Add runbooks for startup failures, OAuth/JWKS failures, rate limiting, dependency advisories, and incident response.

### 3.7.7 Performance, resource isolation, and resilience
1. Establish reproducible baseline benchmarks for representative project sizes and tool calls.
2. Add load, stress, and soak tests with documented machine/runtime context and thresholds.
3. Make analysis time budgets enforceable. Synchronous AST parsing must not be described as cancellable merely because elapsed time is checked between files. Evaluate worker-thread/process isolation or another enforceable timeout boundary.
4. Verify file-count, per-file byte, total-byte, findings, request-body, header, and concurrency limits.
5. Evaluate rate limiting under multiple server instances. If distributed deployment is supported, use a shared limiter or explicitly constrain/document single-instance operation.
6. Add resilience tests for slow clients, aborted requests, malformed HTTP, proxy disconnects, JWKS failures, and graceful shutdown under load.
7. Set performance thresholds from measured baselines and declare them in the report; do not invent targets after seeing results.

### 3.7.8 Release engineering and certification
1. Establish one authoritative version source and ensure package/server/plugin metadata remain consistent.
2. Add reproducible release packaging and automated release notes.
3. Attach SBOM, license inventory, security scan summary, and test evidence to release artifacts.
4. Add a documented rollback procedure and verify rollback artifact/version identification.
5. Publish a production-readiness matrix with PASS, FAIL, BLOCKED, and NOT TESTED statuses and explicit evidence links.
6. Create a release only after required automated gates pass. Live production certification remains blocked if real provider/deployment validation is unavailable.

## 3. Test strategy and evidence requirements

### Automated CI gates
- Clean install from lockfile using the supported Node version.
- Syntax checks and full unit/regression/security test suite.
- MCP STDIO and Streamable HTTP initialize/discovery/list/call tests.
- Authenticated and unauthenticated tool behavior, challenge metadata, scope enforcement, and provider-neutral OAuth simulator coverage.
- Dependency review and vulnerability audit.
- CodeQL/security scanning.
- SBOM generation and license policy evaluation.
- Workflow permission and branch-target safety checks.
- Runtime limits, path traversal/symlink protections, redaction, and no-source-modification regression tests.
- Performance/load suite with recorded baselines and thresholds.

### External/manual gates
- Real HTTPS deployment and reverse-proxy validation.
- Real OAuth/OIDC issuer, JWKS, authorization, token refresh/rotation and revocation behavior as supported.
- Actual ChatGPT connection and tool invocation.
- MCP Inspector compatibility, including the previously documented modern protocol negotiation limitation.
- Operational monitoring, alert delivery, and rollback/redeployment recovery.

External gates must be marked BLOCKED when prerequisites are absent. No fabricated credentials, provider tenants, endpoints, screenshots, or test results.

## 4. Security invariants

- main remains untouched by this implementation until explicit PR approval and merge authorization.
- Repository visibility remains unchanged.
- No secrets are added to source control, workflow logs, artifacts, or test fixtures.
- All tools remain read-only with respect to user projects.
- No execution of project scripts or arbitrary source code.
- No token logging or storage.
- Remote HTTP exposure remains opt-in and protected by OAuth and HTTPS deployment controls.
- Every exception is documented with scope, rationale, owner, and expiry/review date.

## 5. Delivery sequence

Implementation proceeds on the approved feature branch in reviewable commits, grouped by work package. Each group includes tests and documentation. CI must pass before opening/updating the PR. The PR must include:
- work-package checklist and changed-file summary;
- test commands and exact results;
- security findings and disposition;
- dependency/SBOM/license artifacts;
- external validation matrix with blocked items clearly marked;
- deployment and rollback instructions.

No PR merge, main-branch change, repository visibility change, or repository-settings mutation is authorized by this specification alone. The owner reviews the completed PR and explicitly authorizes any merge or settings changes.

## 6. Acceptance criteria

Phase 3.7 implementation is ready for PR review when:
1. All applicable automated gates pass on the feature branch.
2. Security and dependency findings are triaged with no unresolved critical/high finding silently ignored.
3. Runtime and resource controls are tested and documented.
4. OAuth/provider-neutral contract remains covered by automated tests.
5. SBOM and license outputs are generated and reviewable.
6. Release and rollback procedures are documented and validated to the extent possible.
7. A final certification matrix distinguishes verified results from blocked/not-tested external gates.
8. No changes have been made to main or repository visibility.

**Production status rule:** Passing branch CI and completing the PR does not by itself constitute live production certification. Live certification requires the external deployment, identity-provider, and operational evidence listed above.
