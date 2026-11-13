import { createHash } from 'node:crypto';
import { parse } from '@babel/parser';

const SEVERITY = { Critical: 0, High: 1, Medium: 2, Low: 3, Info: 4 };
const PARSER_PLUGINS = ['jsx', 'typescript', 'decorators-legacy', 'classProperties', 'classPrivateProperties', 'classPrivateMethods', 'dynamicImport', 'importAttributes', 'topLevelAwait'];
const MAX_SOURCE_BYTES = 500_000;

function stableId(ruleId, file, line, evidence) {
  const digest = createHash('sha256').update([ruleId, file, line, evidence].join('\0')).digest('hex').slice(0, 12);
  return `RRA-${digest.toUpperCase()}`;
}

function addFinding(findings, rule, file, node, source) {
  const line = node.loc?.start?.line ?? null;
  const evidence = source.slice(node.start ?? 0, Math.min(node.end ?? 0, (node.start ?? 0) + 240)).trim();
  const finding = {
    id: stableId(rule.id, file, line, evidence),
    rule_id: rule.id,
    severity: rule.severity,
    category: rule.category,
    confidence: rule.confidence ?? 'medium',
    file,
    line,
    column: node.loc?.start?.column == null ? null : node.loc.start.column + 1,
    evidence,
    explanation: rule.explanation,
    recommendation: rule.recommendation,
    verification: rule.verification
  };
  findings.push(finding);
}

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (typeof node.type === 'string') visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'extra' || key === 'comments' || key === 'tokens') continue;
    if (Array.isArray(value)) {
      for (const child of value) walk(child, visit);
    } else if (value && typeof value === 'object') {
      walk(value, visit);
    }
  }
}

const RULES = {
  rawHtml: {
    id: 'react/security/raw-html', severity: 'High', category: 'Security',
    explanation: 'Raw HTML insertion can create an XSS risk when the value is untrusted or insufficiently sanitized.',
    recommendation: 'Avoid raw HTML insertion or sanitize untrusted content at a clearly defined trust boundary.',
    verification: 'Trace the value to its source and test malicious payloads in an isolated environment.'
  },
  imageAlt: {
    id: 'jsx/a11y/img-alt', severity: 'Medium', category: 'Accessibility',
    explanation: 'An image element has no explicit alternative-text decision.',
    recommendation: 'Provide meaningful alt text, or alt="" when the image is decorative.',
    verification: 'Inspect the rendered accessibility tree and validate with assistive technology.'
  },
  clickSemantics: {
    id: 'jsx/a11y/click-events-have-key-events', severity: 'Medium', category: 'Accessibility',
    explanation: 'A clickable non-interactive element may not expose control semantics or support keyboard operation.',
    recommendation: 'Prefer a native button or link. If unavoidable, implement role, focusability, and complete keyboard behavior.',
    verification: 'Test keyboard-only operation and inspect the rendered accessibility tree.'
  },
  console: {
    id: 'javascript/no-debugger-console', severity: 'Low', category: 'Maintainability',
    explanation: 'Debug logging may expose data or create noisy production output.',
    recommendation: 'Remove temporary logging or route approved diagnostics through the project logging policy.',
    verification: 'Inspect production output and the logging policy.'
  },
  explicitAny: {
    id: 'typescript/no-explicit-any', severity: 'Low', category: 'TypeScript',
    explanation: 'The any type disables useful static type checking at this location.',
    recommendation: 'Prefer a precise type, unknown with narrowing, or a generic constraint.',
    verification: 'Run the project type checker and inspect the resulting type.'
  }
};

export function analyzeSource(file, source) {
  if (Buffer.byteLength(source, 'utf8') > MAX_SOURCE_BYTES) {
    return { findings: [], parse_error: null, skipped_reason: 'source_exceeds_parser_limit' };
  }
  const isTypeScript = /\.(ts|tsx|mts|cts)$/i.test(file);
  let ast;
  try {
    ast = parse(source, {
      sourceType: 'unambiguous',
      errorRecovery: false,
      allowReturnOutsideFunction: false,
      plugins: isTypeScript ? PARSER_PLUGINS : PARSER_PLUGINS.filter(plugin => plugin !== 'typescript')
    });
  } catch (error) {
    return {
      findings: [],
      parse_error: {
        message: String(error.message).slice(0, 300),
        line: error.loc?.line ?? null,
        column: error.loc?.column == null ? null : error.loc.column + 1
      },
      skipped_reason: 'parse_error'
    };
  }

  const findings = [];
  walk(ast, node => {
    if (node.type === 'JSXAttribute' && node.name?.name === 'dangerouslySetInnerHTML') {
      addFinding(findings, RULES.rawHtml, file, node, source);
    }
    if (node.type === 'JSXOpeningElement' && node.name?.type === 'JSXIdentifier') {
      const tag = node.name.name;
      const attrs = node.attributes.filter(attr => attr.type === 'JSXAttribute');
      const hasAttr = name => attrs.some(attr => attr.name?.name === name);
      if (tag === 'img' && !hasAttr('alt')) addFinding(findings, RULES.imageAlt, file, node, source);
      if ((tag === 'div' || tag === 'span') && hasAttr('onClick') && !hasAttr('role') && !hasAttr('tabIndex')) {
        addFinding(findings, RULES.clickSemantics, file, node, source);
      }
    }
    if (node.type === 'CallExpression' && node.callee?.type === 'MemberExpression'
      && !node.callee.computed && node.callee.object?.name === 'console'
      && ['log', 'debug'].includes(node.callee.property?.name)) {
      addFinding(findings, RULES.console, file, node, source);
    }
    if (isTypeScript && node.type === 'TSAnyKeyword') addFinding(findings, RULES.explicitAny, file, node, source);
  });

  findings.sort((a, b) => (SEVERITY[a.severity] - SEVERITY[b.severity])
    || a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0) || a.rule_id.localeCompare(b.rule_id));
  return { findings, parse_error: null, skipped_reason: null };
}

export function summarizeFindings(findings) {
  const bySeverity = Object.fromEntries(Object.keys(SEVERITY).map(key => [key, findings.filter(item => item.severity === key).length]));
  const byCategory = Object.fromEntries([...new Set(findings.map(item => item.category))].sort()
    .map(key => [key, findings.filter(item => item.category === key).length]));
  return { total: findings.length, by_severity: bySeverity, by_category: byCategory };
}
