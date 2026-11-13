import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { createReviewService } from './review.mjs';

const SERVER_INFO = { name: 'react-review-ai', version: '0.4.0' };
const findingSchema = z.object({
  id: z.string(), rule_id: z.string(), severity: z.enum(['Critical', 'High', 'Medium', 'Low', 'Info']),
  category: z.string(), confidence: z.enum(['low', 'medium', 'high', 'heuristic']),
  file: z.string(), line: z.number().nullable(), column: z.number().nullable(),
  evidence: z.string(), explanation: z.string(), recommendation: z.string(), verification: z.string()
}).passthrough();
const summarySchema = z.object({
  total: z.number(),
  by_severity: z.record(z.string(), z.number()),
  by_category: z.record(z.string(), z.number())
}).passthrough();
const executionSchema = z.object({
  bytes_read: z.number().optional(), truncated: z.boolean(), timed_out: z.boolean(),
  duration_ms: z.number().optional()
}).passthrough();
const outputSchemas = {
  review_project: z.object({ data: z.object({
    product: z.string(), mode: z.string(), project_scope: z.string(),
    scanned_file_count: z.number(), source_file_count: z.number(),
    detected: z.record(z.string(), z.unknown()), summary: summarySchema,
    findings: z.array(findingSchema), parse_errors: z.array(z.object({ file: z.string(), message: z.string(), line: z.number().nullable(), column: z.number().nullable() }).passthrough()),
    skipped_files: z.array(z.object({ file: z.string(), reason: z.string() })),
    execution: executionSchema, limitations: z.array(z.string())
  }).passthrough() }),
  review_component: z.object({ data: z.object({
    file: z.string(), mode: z.string(), summary: summarySchema,
    findings: z.array(findingSchema), parse_error: z.object({
      message: z.string(), line: z.number().nullable(), column: z.number().nullable()
    }).nullable(), skipped_reason: z.string().nullable()
  }).passthrough() }),
  run_test_audit: z.object({ data: z.object({
    mode: z.string(), test_file_count: z.number(), test_files: z.array(z.string()),
    related_config_files: z.array(z.string()), detected_frameworks: z.array(z.string()),
    test_scripts: z.record(z.string(), z.unknown()), inventory_truncated: z.boolean(), note: z.string()
  }).passthrough() }),
  audit_accessibility: z.object({ data: z.object({
    standard_target: z.string(), mode: z.string(), scanned_source_files: z.number(),
    summary: summarySchema, findings: z.array(findingSchema),
    parse_errors: z.array(z.object({ file: z.string(), message: z.string(), line: z.number().nullable(), column: z.number().nullable() }).passthrough()),
    execution: executionSchema, limitations: z.array(z.string())
  }).passthrough() })
};
const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false
};

function asToolResult(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: { data } };
}
function asToolError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return { isError: true, content: [{ type: 'text', text: message }] };
}
function registerReadOnlyTool(server, name, config, handler) {
  server.registerTool(name, {
    ...config,
    outputSchema: outputSchemas[name],
    annotations: READ_ONLY_ANNOTATIONS
  }, async args => {
    try { return asToolResult(await handler(args)); }
    catch (error) { return asToolError(error); }
  });
}

export async function createServer() {
  const review = await createReviewService(process.env.REACT_REVIEW_ROOT);
  const server = new McpServer({
    ...SERVER_INFO,
    instructions: [
      'React Review AI is a read-only static review server.',
      'All tools are restricted to the single trusted project directory configured by REACT_REVIEW_ROOT at startup.',
      'Tool callers cannot provide or override the project root.',
      'Findings are AST-based rule signals and require human validation.',
      'Tests are inventoried but never executed; coverage is never inferred.',
      'Accessibility checks are not a WCAG conformance assessment.',
      'No project source code or scripts are executed or modified.'
    ].join(' ')
  }, { maxToolInputElements: 10_000 });

  registerReadOnlyTool(server, 'review_project', {
    title: 'Review React Project',
    description: 'Read-only AST-based static React project review, bounded by configured file, byte, finding, and time budgets.',
    inputSchema: z.object({}).strict()
  }, () => review.reviewProject());

  registerReadOnlyTool(server, 'review_component', {
    title: 'Review React Component',
    description: 'AST-based review of one source file relative to the trusted project root. Absolute paths and project-root overrides are rejected.',
    inputSchema: z.object({
      file_path: z.string().min(1).describe('Path to one source file, relative to the trusted project root.')
    }).strict()
  }, ({ file_path }) => review.reviewFile(file_path));

  registerReadOnlyTool(server, 'run_test_audit', {
    title: 'Audit React Test Setup',
    description: 'Inventory test files and configuration within the trusted project root; does not run tests or calculate coverage.',
    inputSchema: z.object({}).strict()
  }, () => review.testAudit());

  registerReadOnlyTool(server, 'audit_accessibility', {
    title: 'Audit React Accessibility',
    description: 'AST-based static JSX accessibility heuristics within the trusted project root; not a WCAG conformance or browser/screen-reader assessment.',
    inputSchema: z.object({}).strict()
  }, () => review.accessibilityAudit());

  return server;
}
