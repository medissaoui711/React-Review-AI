# Phase 3.7 — Owner-controlled certification actions

This checklist records items that require repository-owner decisions, repository settings access, or external infrastructure. The implementation branch does not apply these changes automatically.

## Repository settings — pending owner action

- [ ] Keep repository visibility as currently configured (public). No visibility change is requested.
- [ ] Enable and verify GitHub secret scanning and push protection, where available for this repository.
- [ ] Verify the dependency graph is enabled so Dependency Review can compare pull-request dependency changes.
- [ ] Configure a main ruleset or branch protection policy after the required CI check names have been observed on a real run:
  - require pull requests before merging;
  - require at least one approving review;
  - require CODEOWNERS review for owned files;
  - dismiss stale approvals when new commits are pushed;
  - require conversation resolution;
  - require the MCP CI, CodeQL, dependency-review, and supply-chain checks;
  - block force pushes and branch deletion.
- [ ] Decide whether administrators are included in the protection policy and whether emergency bypass is allowed. These are governance decisions, not safe defaults to apply without the owner.

No branch protection, ruleset, secret-scanning, push-protection, Actions permission, environment, secret, or visibility setting has been changed by this implementation.

## Legal and licensing decision — pending owner action

- [ ] Select the project's own distribution license, or explicitly decide to keep it unlicensed/proprietary.
- [ ] Review the generated third-party license inventory against that decision before publishing a release.

No LICENSE file is added by this phase without an explicit license selection. The automated inventory is evidence for human review; it is not legal advice or an automatic compatibility ruling.

## External production certification — blocked until prerequisites exist

- [ ] Provide a reachable production or staging HTTPS MCP endpoint.
- [ ] Configure a real OAuth/OIDC authorization server, client registration, issuer metadata, JWKS, redirect URI, and required scopes.
- [ ] Validate authorization, token refresh/rotation, key rotation, expiry/revocation behavior, and audience/resource binding against that provider.
- [ ] Complete a real ChatGPT connector authorization and tool-call test.
- [ ] Complete MCP Inspector interoperability testing, including the previously recorded modern protocol negotiation limitation.
- [ ] Validate reverse-proxy TLS, firewall restrictions, health/readiness integration, alert delivery, log retention, and rollback in the actual deployment environment.

Provider simulators and automated tests are not substitutes for these live checks. Missing prerequisites must remain BLOCKED or NOT TESTED in the final certification matrix.

## Operational integration — pending deployment design

- [ ] Connect the in-process low-cardinality metrics snapshot to an authenticated metrics exporter or monitoring agent.
- [ ] Define alert thresholds from measured production baselines.
- [ ] Define log retention, access, and deletion policy.
- [ ] Validate backup, rollback, and incident-response procedures.

The HTTP server intentionally does not expose a public metrics endpoint. No monitoring provider, production environment, or secret has been invented or configured.
