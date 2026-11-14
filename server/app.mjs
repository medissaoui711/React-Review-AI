import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { createReviewService } from './review.mjs';
import { readAuthConfig } from './auth.mjs';

const SERVER_INFO = { name: 'react-review-ai', version: '0.6.0' };
const findingSchema = z.object({
  id: z.string(), rule_id: z.string(), severity: z.enum(['Critical', 'High', 'Medium', 'Low', 'Info']),
  category: z.string(), confidence: z.enum(['low', 'medium', 'high', 'heuristic']),
  file: z.string(), line: z.union([z.number().int().positive(), z.null()]), column: z.union([z.number().int().positive(), z.null()]),
  evidence: z.string(), explanation: z.string(), recommendation: z.string(), verification: z.string()
}).strict();
const summarySchema = z.object({
  total: z.number(),
  by_severity: z.record(z.string(), z.number()),
  by_category: z.record(z.string(), z.number())
}).strict();
const executionSchema = z.object({
  bytes_read: z.number().optional(), truncated: z.boolean(), timed_out: z.boolean(),
  duration_ms: z.number().optional()
}).strict();
const outputSchemas = {
  review_project: z.object({ data: z.object({
    product: z.string(), mode: z.string(), project_scope: z.string(),
    scanned_file_count: z.number(), source_file_count: z.number(),
    limits: z.object({ maxFiles: z.number(), maxFileBytes: z.number(), maxTotalBytes: z.number(), maxDurationMs: z.number(), maxFindings: z.number() }).strict(),
    detected: z.object({ react: z.boolean(), typescript: z.boolean(), test_tools: z.array(z.string()) }).strict(), summary: summarySchema,
    findings: z.array(findingSchema), parse_errors: z.array(z.object({ file: z.string(), message: z.string(), line: z.union([z.number().int().positive(), z.null()]), column: z.union([z.number().int().positive(), z.null()]) }).strict()),
    skipped_files: z.array(z.object({ file: z.string(), reason: z.string() })),
    execution: executionSchema, limitations: z.array(z.string())
  }).strict() }),
  review_component: z.object({ data: z.object({
    file: z.string(), mode: z.string(), summary: summarySchema,
    findings: z.array(findingSchema), parse_error: z.object({
      message: z.string(), line: z.union([z.number().int().positive(), z.null()]), column: z.union([z.number().int().positive(), z.null()])
    }).nullable(), skipped_reason: z.union([z.enum(['source_exceeds_parser_limit', 'parse_error', 'analysis_timeout', 'analysis_worker_error']), z.null()]), timed_out: z.boolean().optional()
  }).strict() }),
  run_test_audit: z.object({ data: z.object({
    mode: z.string(), test_file_count: z.number(), test_files: z.array(z.string()),
    related_config_files: z.array(z.string()), detected_frameworks: z.array(z.string()),
    test_scripts: z.record(z.string(), z.string()), inventory_truncated: z.boolean(), note: z.string()
  }).strict() }),
  audit_accessibility: z.object({ data: z.object({
    standard_target: z.string(), mode: z.string(), scanned_source_files: z.number(),
    summary: summarySchema, findings: z.array(findingSchema),
    parse_errors: z.array(z.object({ file: z.string(), message: z.string(), line: z.union([z.number().int().positive(), z.null()]), column: z.union([z.number().int().positive(), z.null()]) }).strict()),
    execution: executionSchema, limitations: z.array(z.string())
  }).strict() })
};
const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false
};

function oauthToolConfig(env = process.env) {
  const config = readAuthConfig(env, { allowHttpLoopback: env.NODE_ENV === 'test' });
  const configured = Boolean(config);
  const scope = config?.scope || 'review:read';
  const runtime = config ? {
    challenge(errorCode, description) {
      const safeDescription = String(description).replace(/[^a-zA-Z0-9 .,:;_'-]/g, ' ').slice(0, 180);
      const error = errorCode === 'insufficient_scope' ? 'insufficient_scope' : 'invalid_token';
      return `Bearer resource_metadata="${config.metadataUrl}", scope="${scope}", error="${error}", error_description="${safeDescription}"`;
    }
  } : null;
  return {
    enabled: configured,
    scope,
    runtime,
    securitySchemes: configured
      ? [{ type: 'oauth2', scopes: [scope] }]
      : [{ type: 'noauth' }]
  };
}

function asToolResult(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: { data } };
}

function asToolError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return { isError: true, content: [{ type: 'text', text: message }] };
}

function authRequiredResult(oauth, authInfo) {
  const insufficientScope = authInfo?.authFailure?.errorCode === 'insufficient_scope';
  const error = insufficientScope ? 'insufficient_scope' : 'invalid_token';
  const description = insufficientScope
    ? 'The access token does not include the required scope.'
    : 'Authentication is required. Connect an OAuth account and retry this tool.';
  const challenge = oauth.challenge(error, description);
  return {
    isError: true,
    content: [{ type: 'text', text: description }],
    _meta: { 'mcp/www_authenticate': [challenge] }
  };
}

function registerReadOnlyTool(server, name, config, handler, oauth) {
  server.registerTool(name, {
    ...config,
    outputSchema: outputSchemas[name],
    annotations: READ_ONLY_ANNOTATIONS,
    _meta: { securitySchemes: oauth.securitySchemes }
  }, async (args, context) => {
    try {
      // HTTP requests carry ctx.http; STDIO remains local and keeps its existing
      // trusted-environment behavior. Only tool invocation is gated.
      if (oauth.enabled && context?.http) {
        const authInfo = context.http.authInfo;
        if (!authInfo || authInfo.authFailure || !authInfo.scopes?.includes(oauth.scope)) {
          return authRequiredResult(oauth.runtime, authInfo);
        }
      }
      return asToolResult(await handler(args, context));
    } catch (error) {
      return asToolError(error);
    }
  });
}

export async function createServer({ metrics, env = process.env, workspaceManager } = {}) {
  const manager = workspaceManager ?? null;
  const oauth = oauthToolConfig(env);
  const localReview = (!manager || !oauth) && env.REACT_REVIEW_ROOT
    ? await createReviewService(env.REACT_REVIEW_ROOT, { metrics })
    : null;
  const resolveReview = async (args, context) => {
    const authInfo = context?.http?.authInfo;
    if (authInfo?.userId) {
      if (!manager) throw new Error('Workspace service is unavailable.');
      const workspaceRoot = await manager.resolve(authInfo.userId, args.workspace_id);
      return createReviewService(workspaceRoot, { metrics });
    }
    if (context?.http && oauth.enabled) throw new Error('An authenticated workspace is required.');
    if (args.workspace_id) throw new Error('Workspace access requires an authenticated user.');
    if (!localReview) throw new Error('Upload a project workspace before invoking review tools.');
    return localReview;
  };
  const server = new McpServer({
    ...SERVER_INFO,
    instructions: [
      'React Review AI is a read-only static review server.',
      'HTTP users must supply a workspace ID owned by their verified OAuth subject; workspace IDs cannot be shared across users.',
      'Local STDIO may use the trusted REACT_REVIEW_ROOT; callers cannot provide or override a project root.',
      'Findings are AST-based rule signals and require human validation.',
      'Tests are inventoried but never executed; coverage is never inferred.',
      'Accessibility checks are not a WCAG conformance assessment.',
      'No project source code or scripts are executed or modified.',
      'HTTP tool calls require OAuth when an identity provider is configured; initialize and tool discovery remain available without a token.'
    ].join(' ')
  }, { maxToolInputElements: 10_000, supportedProtocolVersions: ['2026-07-28'] });

  registerReadOnlyTool(server, 'review_project', {
    title: 'Review React Project',
    description: 'Read-only AST-based static React project review, bounded by configured file, byte, finding, and time budgets.',
    inputSchema: z.object({ workspace_id: z.string().uuid().optional().describe('Required for authenticated HTTP; omit only for local STDIO.') }).strict()
  }, async (args, context) => (await resolveReview(args, context)).reviewProject(), oauth);

  registerReadOnlyTool(server, 'review_component', {
    title: 'Review React Component',
    description: 'Read-only AST review of one source file in an isolated worker with an enforceable analysis timeout. Absolute paths and project-root overrides are rejected.',
    inputSchema: z.object({
      file_path: z.string().min(1).describe('Path to one source file, relative to the authorized workspace.'),
      workspace_id: z.string().uuid().optional().describe('Workspace ID returned by the authenticated workspace upload endpoint.')
    }).strict()
  }, async (args, context) => (await resolveReview(args, context)).reviewFile(args.file_path), oauth);

  registerReadOnlyTool(server, 'run_test_audit', {
    title: 'Audit React Test Setup',
    description: 'Inventory test files and configuration within the authorized project workspace; does not run tests or calculate coverage.',
    inputSchema: z.object({ workspace_id: z.string().uuid().optional().describe('Workspace ID returned by the authenticated workspace upload endpoint.') }).strict()
  }, async (args, context) => (await resolveReview(args, context)).testAudit(), oauth);

  registerReadOnlyTool(server, 'audit_accessibility', {
    title: 'Audit React Accessibility',
    description: 'AST-based static JSX accessibility heuristics within the authorized project workspace; not a WCAG conformance or browser/screen-reader assessment.',
    inputSchema: z.object({ workspace_id: z.string().uuid().optional().describe('Workspace ID returned by the authenticated workspace upload endpoint.') }).strict()
  }, async (args, context) => (await resolveReview(args, context)).accessibilityAudit(), oauth);

  return server;
}
