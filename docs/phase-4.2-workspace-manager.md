# Phase 4.2 — Temporary Project Workspaces

## Objective

Replace the remote MCP service's single fixed project root with short-lived, user-owned workspaces while preserving the trusted local STDIO workflow.

## Architecture

- WorkspaceManager owns temporary workspace directories under the Node.js host's operating-system temporary directory.
- Workspace ownership is bound to the verified OAuth JWT sub claim. The client cannot supply a filesystem path or user identity.
- The HTTP API accepts a ZIP archive and returns an opaque workspace_id.
- MCP review tools resolve that ID against the authenticated subject before opening files.
- The local STDIO transport continues to use REACT_REVIEW_ROOT as a trusted operator-configured directory.
- Uploaded project code, package scripts, and tests are never executed.

## Workspace HTTP API

### Create

POST /workspaces

Required:
- OAuth bearer token with the configured review scope.
- Content-Type: application/zip (or application/octet-stream).
- Raw ZIP bytes as the request body.

Successful response (201) contains:
- workspace_id
- expires_at
- file_count
- Applied archive and workspace limits.

### Delete

DELETE /workspaces/{workspace_id}

Requires the same authenticated subject that created the workspace. Returns 204 on deletion and 404 for missing or non-owned workspaces.

## MCP tool inputs

All four review tools accept optional workspace_id:
- review_project
- review_component
- run_test_audit
- audit_accessibility

For authenticated HTTP calls, workspace_id is required in practice. review_component additionally requires a workspace-relative file_path. Local STDIO calls may omit the workspace ID and continue using REACT_REVIEW_ROOT.

## ZIP intake safeguards

| Limit | Default |
|---|---:|
| Compressed archive | 20 MB |
| Entries | 2,500 |
| Individual uncompressed file | 500 KB |
| Total uncompressed content | 20 MB |
| Directory depth | 20 |
| Workspaces per user | 3 |
| Workspace lifetime | 30 minutes |

Additional controls:
- Reject absolute paths, drive-qualified paths, parent traversal, empty path segments, duplicate paths, and backslash paths.
- Reject symlinks and special filesystem entries.
- Reject encrypted, ZIP64, multi-volume, and unsupported compression entries.
- Support ZIP Store and Deflate only.
- Validate central/local headers, decompressed sizes, and CRC32 before writing.
- Create directories and files with restrictive permissions; files use exclusive creation.
- Bound HTTP request bodies before buffering and extraction.
- Revalidate workspace ownership and real path before every MCP analysis.

## Operational constraints and remaining production gates

- Workspace metadata is currently held in process memory and files on the Node host's temporary filesystem. This implementation is suitable for a single Node process; multi-instance deployments require shared workspace metadata/storage or enforced single-instance routing.
- Process restart invalidates all workspace IDs; temporary files are removed when the manager closes and otherwise rely on host temporary-directory lifecycle if the process is terminated abruptly.
- Automatic TTL cleanup runs once per minute, with expiry checked again on workspace access.
- Existing rate limits apply to workspace upload requests.
- This phase does not deploy the backend, configure a host, change OAuth provider settings, or alter Cloudflare resources.
- worker_threads provides analysis timeouts but is not an operating-system security sandbox. A stronger process/container isolation assessment remains a separate production gate.
- Integration tests against a live OAuth provider and a deployed Node host remain outstanding.

## Validation scope

Unit tests cover extraction, owner isolation, path traversal, absolute paths, symlink rejection, duplicate paths, checksum validation, size limits, quota enforcement, expiry cleanup, and missing identities. CI must pass before this phase is considered validated.
