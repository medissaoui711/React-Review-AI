import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { createReviewService } from './review.mjs';

const SERVER_INFO = { name: 'react-review-ai', version: '0.3.0' };
const OUTPUT_SCHEMA = z.object({ data: z.record(z.string(), z.unknown()) });
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
  return { isError: true, content: [{ type: 'text', text: message }] };
}

function registerReadOnlyTool(server, name, config, handler) {
  server.registerTool(name, {
    ...config,
    outputSchema: OUTPUT_SCHEMA,
    annotations: READ_ONLY_ANNOTATIONS
  }, async (args) => {
    try {
      return asToolResult(await handler(args));
    } catch (error) {
      return asToolError(error);
    }
  });
}

/** Build a fresh MCP server whose tools share one trusted, read-only project root. */
export async function createServer() {
  const review = await createReviewService(process.env.REACT_REVIEW_ROOT);
  const server = new McpServer({
    ...SERVER_INFO,
    instructions: [
      'React Review AI is a read-only static review server.',
      'All tools are restricted to the single trusted project directory configured by REACT_REVIEW_ROOT at startup.',
      'Tool callers cannot provide or override the project root.',
      'Findings are heuristic and require human validation.',
      'Tests are inventoried but never executed; coverage is never inferred.',
      'Accessibility checks are not a WCAG conformance assessment.',
      'No project source code or scripts are executed or modified.'
    ].join(' ')
  }, { maxToolInputElements: 10_000 });

  registerReadOnlyTool(server, 'review_project', {
    title: 'Review React Project',
    description: 'Read-only comprehensive static React project review, limited to the trusted REACT_REVIEW_ROOT configured at server startup. No code or tests are executed.',
    inputSchema: z.object({}).strict()
  }, () => review.reviewProject());

  registerReadOnlyTool(server, 'review_component', {
    title: 'Review React Component',
    description: 'Review one React source file relative to the trusted REACT_REVIEW_ROOT. Absolute paths and project-root overrides are not accepted.',
    inputSchema: z.object({
      file_path: z.string().min(1).describe('Path to one source file, relative to the trusted project root.')
    }).strict()
  }, ({ file_path }) => review.reviewFile(file_path));

  registerReadOnlyTool(server, 'run_test_audit', {
    title: 'Audit React Test Setup',
    description: 'Inventory test files and configuration within the trusted project root; does not run tests, scripts, or calculate coverage.',
    inputSchema: z.object({}).strict()
  }, () => review.testAudit());

  registerReadOnlyTool(server, 'audit_accessibility', {
    title: 'Audit React Accessibility',
    description: 'Heuristic static JSX/TSX accessibility audit within the trusted project root; not a WCAG conformance claim or browser/screen-reader test.',
    inputSchema: z.object({}).strict()
  }, () => review.accessibilityAudit());

  return server;
}
