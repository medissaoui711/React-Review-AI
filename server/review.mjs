import fs from 'node:fs/promises';
import path from 'node:path';
import { summarizeFindings } from './analysis-engine.mjs';
import { createAnalysisRunner } from './analysis-runner.mjs';

const ignored = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.turbo']);
const extensions = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.mts', '.cts']);
const LIMITS = Object.freeze({
  maxFiles: 2500,
  maxFileBytes: 500_000,
  maxTotalBytes: 20_000_000,
  maxDurationMs: 10_000,
  maxFindings: 5000
});

function assertInside(root, candidate, message = 'Path is outside project root.') {
  if (candidate !== root && !candidate.startsWith(root + path.sep)) throw new Error(message);
}

async function resolveSafe(root, relativePath) {
  if (typeof relativePath !== 'string' || relativePath.trim().length === 0) throw new Error('A non-empty project-relative file path is required.');
  if (path.isAbsolute(relativePath)) throw new Error('Absolute file paths are not allowed; use a path relative to the configured project root.');
  const candidate = path.resolve(root, relativePath);
  assertInside(root, candidate);
  const realCandidate = await fs.realpath(candidate);
  assertInside(root, realCandidate, 'Resolved path is outside project root.');
  const stat = await fs.stat(realCandidate);
  if (!stat.isFile()) throw new Error('The requested path is not a regular file.');
  return realCandidate;
}

async function readLimited(file, remainingBytes = LIMITS.maxFileBytes) {
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > LIMITS.maxFileBytes || stat.size > remainingBytes) return null;
    return await fs.readFile(file, 'utf8');
  } catch { return null; }
}

async function readRelativeFile(root, relativePath) {
  try { return await readLimited(await resolveSafe(root, relativePath)); }
  catch { return null; }
}

async function walk(root, budget) {
  const out = [];
  const visit = async dir => {
    if (out.length >= LIMITS.maxFiles || Date.now() - budget.startedAt >= LIMITS.maxDurationMs) return;
    let realDir;
    try {
      realDir = await fs.realpath(dir);
      assertInside(root, realDir);
    } catch { return; }
    let entries;
    try { entries = await fs.readdir(realDir, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      if (out.length >= LIMITS.maxFiles || Date.now() - budget.startedAt >= LIMITS.maxDurationMs) break;
      if (entry.name.startsWith('.') || ignored.has(entry.name)) continue;
      const target = path.join(realDir, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile()) {
        try {
          const realTarget = await fs.realpath(target);
          assertInside(root, realTarget);
          const stat = await fs.stat(realTarget);
          if (stat.isFile()) out.push({ file: realTarget, size: stat.size });
        } catch { /* Ignore inaccessible and out-of-root entries. */ }
      }
    }
  };
  await visit(root);
  return out;
}

function inventoryMetadata(all, sourceFiles) {
  return {
    scanned_file_count: all.length,
    source_file_count: sourceFiles.length,
    limits: { ...LIMITS }
  };
}

export async function createReviewService(configuredRoot) {
  if (typeof configuredRoot !== 'string' || !configuredRoot.trim()) throw new Error('REACT_REVIEW_ROOT must be set to an absolute project directory before the server starts.');
  if (!path.isAbsolute(configuredRoot)) throw new Error('REACT_REVIEW_ROOT must be an absolute path.');
  let root;
  try { root = await fs.realpath(configuredRoot); }
  catch { throw new Error('REACT_REVIEW_ROOT must point to an existing accessible directory.'); }
  if (!(await fs.stat(root)).isDirectory()) throw new Error('REACT_REVIEW_ROOT must point to a directory.');

  async function collectSource() {
    const budget = { startedAt: Date.now(), bytesRead: 0, truncated: false, timedOut: false };
    const runner = createAnalysisRunner();
    try {
      const all = await walk(root, budget);
      if (Date.now() - budget.startedAt >= LIMITS.maxDurationMs) budget.timedOut = true;
      const source = all.filter(item => extensions.has(path.extname(item.file).toLowerCase()));
      const findings = [];
      const parseErrors = [];
      const skipped = [];

      for (const item of source) {
        const elapsed = Date.now() - budget.startedAt;
        if (elapsed >= LIMITS.maxDurationMs) { budget.timedOut = true; break; }
        if (budget.bytesRead + item.size > LIMITS.maxTotalBytes) { budget.truncated = true; break; }
        if (item.size > LIMITS.maxFileBytes) { skipped.push({ file: path.relative(root, item.file), reason: 'file_exceeds_limit' }); continue; }
        const relative = path.relative(root, item.file);
        const content = await readLimited(item.file, LIMITS.maxTotalBytes - budget.bytesRead);
        if (content === null) { skipped.push({ file: relative, reason: 'unreadable_or_changed_during_scan' }); continue; }
        budget.bytesRead += Buffer.byteLength(content, 'utf8');

        const remainingMs = LIMITS.maxDurationMs - (Date.now() - budget.startedAt);
        if (remainingMs < 1) { budget.timedOut = true; break; }
        let result;
        try {
          result = await runner.analyze(relative, content, remainingMs);
        } catch {
          skipped.push({ file: relative, reason: 'analysis_worker_error' });
          parseErrors.push({ file: relative, message: 'Isolated AST analysis worker failed.', line: null, column: null });
          budget.truncated = true;
          break;
        }
        if (result.timed_out) {
          budget.timedOut = true;
          skipped.push({ file: relative, reason: 'analysis_timeout' });
          break;
        }
        findings.push(...result.findings);
        if (result.parse_error) parseErrors.push({ file: relative, ...result.parse_error });
        if (result.skipped_reason) skipped.push({ file: relative, reason: result.skipped_reason });
        if (findings.length >= LIMITS.maxFindings) { findings.length = LIMITS.maxFindings; budget.truncated = true; break; }
      }

      findings.sort((a, b) => a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0) || a.rule_id.localeCompare(b.rule_id));
      return { all, source, findings, parseErrors, skipped, budget };
    } finally {
      await runner.close();
    }
  }

  async function reviewProject() {
    const result = await collectSource();
    let dependencies = {};
    const packageContent = await readRelativeFile(root, 'package.json');
    try { const pkg = JSON.parse(packageContent || '{}'); dependencies = { ...pkg.dependencies, ...pkg.devDependencies }; } catch {}
    return {
      product: 'React Review AI',
      mode: 'read-only AST-based static analysis',
      project_scope: 'configured trusted project root',
      ...inventoryMetadata(result.all, result.source),
      detected: {
        react: Boolean(dependencies.react),
        typescript: Boolean(dependencies.typescript || dependencies['@types/react']),
        test_tools: ['vitest', 'jest', '@testing-library/react'].filter(name => Boolean(dependencies[name]))
      },
      summary: summarizeFindings(result.findings),
      findings: result.findings,
      parse_errors: result.parseErrors,
      skipped_files: result.skipped,
      execution: {
        bytes_read: result.budget.bytesRead,
        truncated: result.budget.truncated,
        timed_out: result.budget.timedOut,
        duration_ms: Date.now() - result.budget.startedAt
      },
      limitations: [
        'No source code or project scripts executed.',
        'No tests run and no actual coverage measured.',
        'AST findings are rule-based signals and require human validation.',
        'No browser, axe-core, or screen-reader audit performed.'
      ]
    };
  }

  async function reviewFile(relativePath) {
    const file = await resolveSafe(root, relativePath);
    const content = await readLimited(file);
    if (content === null) throw new Error('File unavailable, too large, or not a regular text file.');
    const relative = path.relative(root, file);
    const runner = createAnalysisRunner();
    let result;
    try {
      result = await runner.analyze(relative, content, LIMITS.maxDurationMs);
    } catch {
      result = { findings: [], parse_error: null, skipped_reason: 'analysis_worker_error', timed_out: false };
    } finally {
      await runner.close();
    }
    return {
      file: relative,
      mode: 'read-only AST analysis in an isolated worker',
      summary: summarizeFindings(result.findings),
      findings: result.findings,
      parse_error: result.parse_error,
      skipped_reason: result.skipped_reason,
      timed_out: Boolean(result.timed_out)
    };
  }

  async function testAudit() {
    const budget = { startedAt: Date.now() };
    const all = await walk(root, budget);
    const tests = all.filter(item => /\.(test|spec)\.[cm]?[jt]sx?$/i.test(item.file));
    const configs = all.filter(item => /(vitest|jest|playwright|cypress)/i.test(path.basename(item.file)));
    let pkg = {};
    try { pkg = JSON.parse((await readRelativeFile(root, 'package.json')) || '{}'); } catch {}
    const dependencies = { ...pkg.dependencies, ...pkg.devDependencies };
    return {
      mode: 'test inventory only',
      test_file_count: tests.length,
      test_files: tests.slice(0, 250).map(item => path.relative(root, item.file)),
      related_config_files: configs.slice(0, 100).map(item => path.relative(root, item.file)),
      detected_frameworks: ['vitest', 'jest', '@testing-library/react', '@playwright/test', 'cypress'].filter(name => Boolean(dependencies[name])),
      test_scripts: Object.fromEntries(Object.entries(pkg.scripts || {}).filter(([name]) => /test|coverage|e2e/i.test(name))),
      inventory_truncated: all.length >= LIMITS.maxFiles || Date.now() - budget.startedAt >= LIMITS.maxDurationMs,
      note: 'No tests executed; no real coverage percentage inferred.'
    };
  }

  async function accessibilityAudit() {
    const result = await collectSource();
    const findings = result.findings.filter(item => item.category === 'Accessibility');
    return {
      standard_target: 'WCAG 2.2 AA',
      mode: 'AST-based static JSX accessibility heuristics',
      scanned_source_files: result.source.length,
      summary: summarizeFindings(findings),
      findings,
      parse_errors: result.parseErrors,
      execution: {
        bytes_read: result.budget.bytesRead,
        truncated: result.budget.truncated,
        timed_out: result.budget.timedOut
      },
      limitations: [
        'Not a WCAG conformance assessment.',
        'Contrast, focus order, dynamic states, and live regions need rendered-page testing.',
        'Manual keyboard and assistive-technology testing remain necessary.'
      ]
    };
  }

  return Object.freeze({ reviewProject, reviewFile, testAudit, accessibilityAudit });
}
