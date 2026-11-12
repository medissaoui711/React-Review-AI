# React Review AI

Read-only React code review MCP server and ChatGPT plugin source.

## Requirements
- Node.js 22+
- npm

## Install and run
```bash
npm ci
npm start
```

## MCP tools
- `review_project`
- `review_component`
- `run_test_audit`
- `audit_accessibility`

## Skills
- React code review
- React testing
- Accessibility audit (WCAG 2.2)

The server performs static, read-only analysis. It does not modify project files or execute the user's project tests.

## Validation
GitHub Actions installs the locked dependencies, syntax-checks server modules, negotiates MCP over stdio, lists all tools, and calls each registered tool.
