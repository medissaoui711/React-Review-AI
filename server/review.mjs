import fs from 'node:fs/promises';
import path from 'node:path';

const ignored = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.turbo']);
const extensions = new Set(['.js', '.jsx', '.ts', '.tsx']);
const maxFiles = 2500;
const maxBytes = 500000;

function assertInside(root, candidate, message = 'Path is outside project root.') {
  if (candidate !== root && !candidate.startsWith(root + path.sep)) {
    throw new Error(message);
  }
}

async function resolveSafe(root, relativePath) {
  if (typeof relativePath !== 'string' || relativePath.trim().length === 0) {
    throw new Error('A non-empty project-relative file path is required.');
  }
  if (path.isAbsolute(relativePath)) {
    throw new Error('Absolute file paths are not allowed; use a path relative to the configured project root.');
  }
  const candidate = path.resolve(root, relativePath);
  assertInside(root, candidate);
  const realCandidate = await fs.realpath(candidate);
  assertInside(root, realCandidate, 'Resolved path is outside project root.');
  const stat = await fs.stat(realCandidate);
  if (!stat.isFile()) throw new Error('The requested path is not a regular file.');
  return realCandidate;
}

async function readFileLimited(file) {
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size > maxBytes) return null;
    return await fs.readFile(file, 'utf8');
  } catch {
    return null;
  }
}

async function readRelativeFile(root, relativePath) {
  try {
    const file = await resolveSafe(root, relativePath);
    return await readFileLimited(file);
  } catch {
    return null;
  }
}

async function walk(root, dir = root, out = []) {
  if (out.length >= maxFiles) return out;

  // Re-check each directory's canonical location before traversing it.
  let realDir;
  try {
    realDir = await fs.realpath(dir);
    assertInside(root, realDir, 'Resolved directory is outside project root.');
  } catch {
    return out;
  }

  let entries;
  try {
    entries = await fs.readdir(realDir, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of entries) {
    if (out.length >= maxFiles) break;
    if (entry.name.startsWith('.') || ignored.has(entry.name)) continue;
    const target = path.join(realDir, entry.name);
    if (entry.isDirectory()) {
      await walk(root, target, out);
    } else if (entry.isFile()) {
      // Only retain canonical regular files inside the configured root.
      try {
        const realTarget = await fs.realpath(target);
        assertInside(root, realTarget, 'Resolved file is outside project root.');
        const stat = await fs.stat(realTarget);
        if (stat.isFile()) out.push(realTarget);
      } catch {
        // Ignore inaccessible, replaced, or out-of-root entries.
      }
    }
  }
  return out;
}

function inspect(file, source, sequenceStart = 0) {
  const findings = [];
  const add = (line, severity, category, evidence, explanation, recommendation, verification) => {
    findings.push({
      id: `RRA-${String(sequenceStart + findings.length + 1).padStart(4, '0')}`,
      severity, category, file, line,
      evidence: evidence.trim().slice(0, 220), explanation, recommendation, verification,
      confidence: 'heuristic'
    });
  };
  source.split(/\\r?\\n/).forEach((line, index) => {
    const number = index + 1;
    if (/dangerouslySetInnerHTML/.test(line)) add(number, 'High', 'Security', line,
      'Raw HTML insertion can create XSS risk if content is untrusted or unsanitized.',
      'Avoid raw HTML or sanitize through a maintained sanitizer at a clear trust boundary.',
      'Trace data sources and test malicious payloads in an isolated test environment.');
    if (/<img\\b/.test(line) && !/\\balt\\s*=/.test(line)) add(number, 'Medium', 'Accessibility', line,
      'Image may lack an alternative text decision.',
      'Add meaningful alt text, or alt="" for decorative images.',
      'Inspect the rendered accessibility tree and test with assistive technology.');
    if (/<(div|span)\\b[^>]*onClick\\s*=/.test(line) && !/\\b(role|tabIndex)\\s*=/.test(line)) add(number, 'Medium', 'Accessibility', line,
      'Clickable non-semantic element may not support keyboard interaction or expose control semantics.',
      'Prefer a native button or link; otherwise implement complete semantics, focus, and keyboard behavior.',
      'Test keyboard-only operation and inspect the accessibility tree.');
    if (/console\\.(log|debug)\\s*\\(/.test(line)) add(number, 'Low', 'Maintainability', line,
      'Debug logging may expose data or create noisy production output.',
      'Remove temporary logs or use an approved logging policy.',
      'Inspect production build and logging policy.');
    if (/\\bany\\b/.test(line) && /\\.(ts|tsx)$/.test(file)) add(number, 'Low', 'TypeScript', line,
      'The any type disables useful static checks here.',
      'Prefer a precise type, unknown with narrowing, or a generic constraint.',
      'Run TypeScript typechecking and inspect the narrowed type.');
  });
  return findings;
}

async function sourceFiles(root) {
  const all = await walk(root);
  return { all, files: all.filter(file => extensions.has(path.extname(file))) };
}

/**
 * Creates a review service bound to one canonical project root.
 * The root is supplied by trusted server configuration, never by a tool caller.
 */
export async function createReviewService(configuredRoot) {
  if (typeof configuredRoot !== 'string' || configuredRoot.trim().length === 0) {
    throw new Error('REACT_REVIEW_ROOT must be set to an absolute project directory before the server starts.');
  }
  if (!path.isAbsolute(configuredRoot)) {
    throw new Error('REACT_REVIEW_ROOT must be an absolute path.');
  }

  let root;
  try {
    root = await fs.realpath(configuredRoot);
  } catch {
    throw new Error('REACT_REVIEW_ROOT must point to an existing accessible directory.');
  }
  const rootStat = await fs.stat(root);
  if (!rootStat.isDirectory()) {
    throw new Error('REACT_REVIEW_ROOT must point to a directory.');
  }

  async function reviewProject() {
    const { all, files } = await sourceFiles(root);
    const findings = [];
    for (const file of files) {
      const relative = path.relative(root, file);
      const content = await readRelativeFile(root, relative);
      if (content !== null) findings.push(...inspect(relative, content, findings.length));
    }
    let dependencies = {};
    const packageContent = await readRelativeFile(root, 'package.json');
    try {
      const pkg = JSON.parse(packageContent || '{}');
      dependencies = { ...pkg.dependencies, ...pkg.devDependencies };
    } catch {}
    return {
      product: 'React Review AI', mode: 'read-only static heuristic review',
      project_scope: 'configured trusted project root',
      scanned_file_count: all.length, source_file_count: files.length,
      detected: {
        react: Boolean(dependencies.react), typescript: Boolean(dependencies.typescript),
        test_tools: ['vitest', 'jest', '@testing-library/react'].filter(name => Boolean(dependencies[name]))
      },
      findings,
      limitations: [
        'No source code executed.', 'No tests run and no actual coverage measured.',
        'Findings are heuristic and require validation.', 'No browser, axe-core, or screen-reader audit performed.'
      ]
    };
  }

  async function reviewFile(relativePath) {
    const file = await resolveSafe(root, relativePath);
    const content = await readFileLimited(file);
    if (content === null) throw new Error('File unavailable, too large, or not a regular text file.');
    return { file: path.relative(root, file), mode: 'read-only heuristic', findings: inspect(path.relative(root, file), content) };
  }

  async function testAudit() {
    const all = await walk(root);
    const tests = all.filter(file => /\\.(test|spec)\\.[cm]?[jt]sx?$/.test(file));
    const configs = all.filter(file => /(vitest|jest|playwright|cypress)/i.test(path.basename(file)));
    let pkg = {};
    try {
      pkg = JSON.parse((await readRelativeFile(root, 'package.json')) || '{}');
    } catch {}
    const dependencies = { ...pkg.dependencies, ...pkg.devDependencies };
    return {
      mode: 'test inventory only', test_file_count: tests.length,
      test_files: tests.slice(0, 250).map(file => path.relative(root, file)),
      related_config_files: configs.slice(0, 100).map(file => path.relative(root, file)),
      detected_frameworks: ['vitest', 'jest', '@testing-library/react', '@playwright/test', 'cypress'].filter(name => Boolean(dependencies[name])),
      test_scripts: Object.fromEntries(Object.entries(pkg.scripts || {}).filter(([name]) => /test|coverage|e2e/i.test(name))),
      note: 'No tests executed; no real coverage percentage inferred.'
    };
  }

  async function accessibilityAudit() {
    const { files } = await sourceFiles(root);
    const findings = [];
    let sequenceCursor = 0;
    for (const file of files) {
      const relative = path.relative(root, file);
      const content = await readRelativeFile(root, relative);
      if (content !== null) {
        const allMatches = inspect(relative, content, sequenceCursor);
        sequenceCursor += allMatches.length;
        findings.push(...allMatches.filter(item => item.category === 'Accessibility'));
      }
    }
    return {
      standard_target: 'WCAG 2.2 AA', mode: 'heuristic static JSX/TSX inspection',
      scanned_source_files: files.length, findings,
      limitations: [
        'Not a WCAG conformance assessment.',
        'Contrast, focus order, dynamic states, and live regions need rendered-page testing.',
        'Manual keyboard and assistive-technology testing remain necessary.'
      ]
    };
  }

  return Object.freeze({ reviewProject, reviewFile, testAudit, accessibilityAudit });
}
