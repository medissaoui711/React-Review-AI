# React Review AI

Read-only React code review MCP server with local STDIO and Streamable HTTP transports.

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
$env:REACT_REVIEW_ROOT = "C:\absolute\path\to\react-project"
npm start
```

The server resolves and validates this directory once per server instance. If the variable is missing, relative, inaccessible, or not a directory, startup fails closed. All four tools share this fixed root; callers cannot supply or override it.

## MCP transports

### STDIO (local integrations)

```bash
REACT_REVIEW_ROOT=/absolute/path/to/react-project npm start
```

### Streamable HTTP (local-only)

```bash
REACT_REVIEW_ROOT=/absolute/path/to/react-project npm run start:http
```

The HTTP transport listens only on `127.0.0.1` and exposes one endpoint: `http://127.0.0.1:3000/mcp`. Set `PORT` to change the port. It uses the official MCP `createMcpHandler` entry with stateless request handling; each request receives a fresh MCP server instance and no protocol session is retained.

The endpoint validates `Host` and any supplied `Origin` against localhost allowlists. The current protocol revision uses POST requests; standalone GET and DELETE session operations are not supported. The HTTP endpoint is intentionally local-only and has no authentication. Do not expose it on a public or untrusted network; remote authenticated deployment is reserved for Phase 3.5.

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

GitHub Actions syntax-checks the server modules, runs security/regression and HTTP transport tests, negotiates MCP over STDIO and Streamable HTTP, verifies that no tool exposes a project-root override, and calls each registered tool over both transports.
