# Phase 3.7 — Evidence and certification matrix

**Implementation branch:** phase-3.7-production-hardening  
**Base main SHA:** 8087b028dfc598ded19fc942a40b54680c87193f  
**Repository visibility:** public; preserved  
**Matrix rule:** `IMPLEMENTED` means code/configuration exists; it does not mean tests passed. `PASS` requires an observed test result or external evidence.

| Work package | Evidence added on branch | Current status | Remaining evidence / gate |
|---|---|---|---|
| 3.7.1 Governance | SECURITY.md, CODEOWNERS, PR template, frozen spec, owner-action checklist | IMPLEMENTED | Main ruleset/branch protection and secret-scanning settings require owner authorization |
| 3.7.2 Supply chain | Dependabot, immutable action pins, dependency review workflow, npm audit gate; Zod upgraded to 4.6.7 | PARTIAL — [security run 95](https://github.com/medissaoui711/React-Review-AI/actions/runs/43391007922): npm audit found 0 vulnerabilities; Dependency Review ran on PR #6 but is blocked | Enable GitHub Dependency Graph, then rerun Dependency Review |
| 3.7.3 Security scanning and SBOM | CodeQL JS/TS + Actions, CycloneDX 1.5 SBOM, license inventory and uploaded artifact | PASS — [security run 95](https://github.com/medissaoui711/React-Review-AI/actions/runs/43391007922): both CodeQL jobs succeeded; [SBOM/license artifact](https://github.com/medissaoui711/React-Review-AI/actions/runs/43391007922/artifacts/14019929525) contains 22 packages and 0 unknown licenses | Dependency Review is blocked until Dependency Graph is enabled; secret scanning/push protection remain owner settings |
| 3.7.4 Runtime | /healthz, /readyz, bounded graceful shutdown, strict port/connection limits, remote Host/Origin hardening | PASS — [MCP CI run 222](https://github.com/medissaoui711/React-Review-AI/actions/runs/43391007938): HTTP runtime and bounded-shutdown regression tests passed | Real reverse-proxy deployment validation remains external |
| 3.7.5 OAuth lifecycle | JWKS key-rotation/outage tests, not-before validation, retryable 503 for JWKS infrastructure failures | PASS — [MCP CI run 222](https://github.com/medissaoui711/React-Review-AI/actions/runs/43391007938): automated OAuth lifecycle tests passed | Live provider, revocation and refresh validation remain external |
| 3.7.6 Observability | Correlation IDs, sanitized JSON request logs, low-cardinality in-process metrics snapshot | PASS — [MCP CI run 222](https://github.com/medissaoui711/React-Review-AI/actions/runs/43391007938): logging and metrics regression tests passed | Exporter, alerting, retention and access policy remain deployment work |
| 3.7.7 Resilience and performance | AST worker-thread isolation, enforceable parser deadline, HTTP concurrency cap, timeout tests, synthetic 100-file CI benchmark | PASS — [MCP CI run 222](https://github.com/medissaoui711/React-Review-AI/actions/runs/43391007938): 100 files / 102,400 bytes / 100 findings / 0 parse errors / 173.8 ms / no timeout or truncation; [benchmark artifact](https://github.com/medissaoui711/React-Review-AI/actions/runs/43391007938/artifacts/14020404130) | Deployment load/soak tests and shared multi-instance rate limits remain |
| 3.7.8 Release engineering | Manual tag certification workflow, source archive, SBOM, license inventory, SHA-256 manifest, generated release notes | IMPLEMENTED / NOT RUN | No tag or release created; owner must explicitly dispatch after version/tag approval |

## External gates

| External gate | Status |
|---|---|
| GitHub Dependency Graph / Dependency Review | BLOCKED — PR #6 confirms the repository Dependency Graph is disabled; owner must enable it |
| Live HTTPS deployment and reverse-proxy validation | BLOCKED — no deployment endpoint supplied |
| Real OAuth/OIDC provider validation | BLOCKED — no provider tenant/credentials supplied |
| Actual ChatGPT connection and tool invocation | BLOCKED — requires reachable deployment and provider |
| MCP Inspector modern-protocol interoperability | NOT TESTED — previously documented negotiation limitation remains open |
| Production metrics exporter and alert delivery | BLOCKED — deployment integration not configured |
| Legal project license selection | BLOCKED — owner decision required |
| Main branch protection and secret-scanning settings | BLOCKED — separate owner authorization required |

## Evidence integrity

- No test result is marked PASS until a workflow or local test execution result is observed.
- MCP CI run 222 passed 55/55 tests, STDIO and HTTP integration, all four tool calls, and the synthetic performance benchmark. Security workflow run 95 passed both CodeQL analyses and npm audit, and uploaded the CycloneDX/license artifact. PR #6 then executed Dependency Review, but the action failed because the repository Dependency Graph is disabled. The benchmark and SBOM/license artifacts are linked in the matrix. An empty commit-status response is not proof that CI passed or failed.
- No production release, tag, live OAuth connection, or ChatGPT connection has been created or claimed.
- main must remain at the base SHA until the owner reviews the completed PR and explicitly approves merge.
