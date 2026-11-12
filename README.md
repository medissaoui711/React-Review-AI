# React Review AI

Read-only React code review MCP server and ChatGPT plugin source.

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
$env:REACT_REVIEW_ROOT = "C:\\absolute\\path\\to\\react-project"
npm start
```

The server resolves and validates this directory once at startup. If the variable is missing, relative, inaccessible, or not a directory, startup fails closed. All four tools share this fixed root; callers cannot supply or override it.

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

GitHub Actions installs locked dependencies, syntax-checks server modules, runs security and regression tests, negotiates MCP over stdio, verifies that no tool exposes a project-root override, and calls each registered tool.
