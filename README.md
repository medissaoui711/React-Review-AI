# React Review AI

Read-only React review plugin source distribution.

## Source bundle

The complete Phase 3.1 source tree is stored in `react-review-ai-source-0.3.0.tar.gz.base64` as a Base64-encoded gzip tar archive.

Decode and extract it:

```bash
base64 -d react-review-ai-source-0.3.0.tar.gz.base64 > react-review-ai-source-0.3.0.tar.gz
tar -xzf react-review-ai-source-0.3.0.tar.gz
```

The bundle contains the MCP server, plugin manifests, and all three skills.

## Phase status

Phase 3.1 SDK migration snapshot. Syntax and archive checks passed locally; dependency installation and live MCP SDK runtime/regression validation remain pending.
