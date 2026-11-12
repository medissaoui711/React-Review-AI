import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';
import {
  reviewProject,
  reviewFile,
  testAudit,
  accessibilityAudit
} from './review.mjs';

const SERVER_INFO = {
  name: 'react-review-ai',
  version: '0.3.0'
};

const OUTPUT_SCHEMA = z.object({
  data: z.record(z.string(), z.unknown())
});

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
};

function asToolResult(data) {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    structuredContent: { data }
  };
}

function asToolError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [{ type: 'text', text: message }]
  };
}

function registerReadOnlyTool(server, name, config, handler) {
  server.registerTool(
    name,
    {
      ...config,
      outputSchema: OUTPUT_SCHEMA,
      annotations: READ_ONLY_ANNOTATIONS
    },
    async (args) => {
      try {
        return asToolResult(await handler(args));
      } catch (error) {
        return asToolError(error);
      }
    }
  );
}

export function createServer() {
  const server = new McpServer(
    {
      ...SERVER_INFO,
      instructions: [
        'React Review AI is a read-only static review server.',
        'Findings are heuristic and require human validation.',
        'Tests are inventoried but never executed; coverage is never inferred.',
        'Accessibility checks are not a WCAG conformance assessment.',
        'No project source code or scripts are executed or modified.'
      ].join(' ')
    },
    { maxToolInputElements: 10_000 }
  );

  registerReadOnlyTool(
    server,
    'review_project',
    {
      title: 'Review React Project',
      description: 'Read-only comprehensive static React project review. Does not execute code or tests.',
      inputSchema: z.object({
        project_root: z.string().min(1).optional().describe('Trusted project root; defaults to REACT_REVIEW_ROOT or the process working directory.')
      }).strict()
    },
    ({ project_root }) => reviewProject(project_root)
  );

  registerReadOnlyTool(
    server,
    'review_component',
    {
      title: 'Review React Component',
      description: 'Review one React source file for common code-quality and accessibility risks. Read-only; no code is executed.',
      inputSchema: z.object({
        file_path: z.string().min(1).describe('Path to one source file, relative to the project root.'),
        project_root: z.string().min(1).optional().describe('Trusted project root; defaults to REACT_REVIEW_ROOT or the process working directory.')
      }).strict()
    },
    ({ file_path, project_root }) => reviewFile(file_path, project_root)
  );

  registerReadOnlyTool(
    server,
    'run_test_audit',
    {
      title: 'Audit React Test Setup',
      description: 'Inventory test files and configuration; does not run tests, scripts, or calculate coverage.',
      inputSchema: z.object({
        project_root: z.string().min(1).optional().describe('Trusted project root; defaults to REACT_REVIEW_ROOT or the process working directory.')
      }).strict()
    },
    ({ project_root }) => testAudit(project_root)
  );

  registerReadOnlyTool(
    server,
    'audit_accessibility',
    {
      title: 'Audit React Accessibility',
      description: 'Heuristic static JSX/TSX accessibility audit; not a WCAG conformance claim and not a browser or screen-reader test.',
      inputSchema: z.object({
        project_root: z.string().min(1).optional().describe('Trusted project root; defaults to REACT_REVIEW_ROOT or the process working directory.')
      }).strict()
    },
    ({ project_root }) => accessibilityAudit(project_root)
  );

  return server;
}

const isDirectExecution = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  // The 2026-07-28 protocol era is intentionally required for this phase.
  // Use the SDK's connection-pinned stdio entry, not a hand-connected transport.
  await serveStdio(createServer, { legacy: 'reject' });
}
