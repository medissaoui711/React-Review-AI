# Phase 3.7 — Evidence and certification matrix

**Implementation branch:** phase-3.7-production-hardening  
**Base main SHA:** 8087b028dfc598ded19fc942a40b54680c87193f  
**Repository visibility:** public; preserved  
**Matrix rule:** `IMPLEMENTED` means code/configuration exists; it does not mean tests passed. `PASS` requires an observed test result or external evidence.

| Work package | Evidence added on branch | Current status | Remaining evidence / gate |
|---|---|---|---|
| 3.7.1 Governance | SECURITY.md, CODEOWNERS, PR template, frozen spec, owner-action checklist | IMPLEMENTED | Main ruleset/branch protection requires owner settings authorization |
| 3.7.2 Supply chain | Dependabot, immutable action pins, dependency review workflow, npm audit gate | IMPLEMENTED / NOT RUN | Observe successful branch CI and triage actual advisories |
| 3.7.3 Security scanning and SBOM | CodeQL JS/TS + Actions, CycloneDX generation, license inventory, artifact upload | IMPLEMENTED / NOT RUN | Observe scanner results; secret scanning/push protection remain owner settings |
| 3.7.4 Runtime | /healthz, /readyz, bounded graceful shutdown, strict port/connection limits, remote Host/Origin hardening | IMPLEMENTED / NOT RUN | Run HTTP regression tests and validate in a real reverse-proxy deployment |
| 3.7.5 OAuth lifecycle | JWKS key-rotation/outage tests, not-before validation, retryable 503 for JWKS infrastructure failures | IMPLEMENTED / NOT RUN | Run tests; live provider, revocation and refresh validation remain external |
| 3.7.6 Observability | Correlation IDs, sanitized JSON request logs, low-cardinality in-process metrics snapshot | IMPLEMENTED / NOT RUN | Run tests; exporter, alerting, retention and access policy remain deployment work |
| 3.7.7 Resilience and performance | AST worker-thread isolation, enforceable parser deadline, HTTP concurrency cap, timeout tests, synthetic 100-file CI benchmark | IMPLEMENTED / NOT RUN | Observe benchmark artifact; deployment load/soak tests and shared multi-instance rate limits remain |
| 3.7.8 Release engineering | Manual tag certification workflow, source archive, SBOM, license inventory, SHA-256 manifest, generated release notes | IMPLEMENTED / NOT RUN | No tag or release created; owner must explicitly dispatch after version/tag approval |

## External gates

| External gate | Status |
|---|---|
| Live HTTPS deployment and reverse-proxy validation | BLOCKED — no deployment endpoint supplied |
| Real OAuth/OIDC provider validation | BLOCKED — no provider tenant/credentials supplied |
| Actual ChatGPT connection and tool invocation | BLOCKED — requires reachable deployment and provider |
| MCP Inspector modern-protocol interoperability | NOT TESTED — previously documented negotiation limitation remains open |
| Production metrics exporter and alert delivery | BLOCKED — deployment integration not configured |
| Legal project license selection | BLOCKED — owner decision required |
| Main branch protection and secret-scanning settings | BLOCKED — separate owner authorization required |

## Evidence integrity

- No test result is marked PASS until a workflow or local test execution result is observed.
- CI workflows are configured to run on the feature branch, but the GitHub Actions run list is not currently exposed by the connected repository actions used in this session. An empty commit-status response is not proof that CI passed or failed.
- No production release, tag, live OAuth connection, or ChatGPT connection has been created or claimed.
- main must remain at the base SHA until the owner reviews the completed PR and explicitly approves merge.
