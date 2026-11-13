# Security Policy

## Supported versions

Security fixes are developed against the latest version on the default branch. Older releases are not guaranteed to receive security updates.

## Reporting a vulnerability

Please do not disclose suspected vulnerabilities in public issues or pull requests.

Use GitHub's private vulnerability reporting feature for this repository when available. Include:
- affected version or commit;
- impact and realistic attack prerequisites;
- reproducible steps or a minimal proof of concept;
- suggested mitigation, if known.

Do not include real access tokens, passwords, private keys, customer data, or other secrets in a report.

## Response and disclosure

The maintainer will acknowledge reports as soon as reasonably possible, assess severity and affected versions, and coordinate a fix and disclosure timeline with the reporter. Public disclosure should wait until a fix or mitigation is available and coordinated.

## Project security boundaries

React Review AI is designed as a read-only static analysis MCP server. It must not execute reviewed project code or scripts, modify reviewed project files, or log bearer tokens and secrets. Report any suspected violation of these boundaries privately.
