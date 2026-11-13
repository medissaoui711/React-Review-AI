import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { analyzeSource, summarizeFindings } from '../server/analysis-engine.mjs';
import { createAnalysisRunner } from '../server/analysis-runner.mjs';

test('AST engine detects multiline JSX attributes and reports precise locations', () => {
  const source = `export function Example() {
  return (
    <section>
      <img
        src="/logo.svg"
      />
      <div
        onClick={() => {}}
      />
    </section>
  );
}`;
  const result = analyzeSource('src/Example.jsx', source);
  assert.equal(result.parse_error, null);
  assert.deepEqual(result.findings.map(item => item.rule_id).sort(), [
    'jsx/a11y/click-events-have-key-events',
    'jsx/a11y/img-alt'
  ]);
  assert.ok(result.findings.every(item => Number.isInteger(item.line) && item.column > 0));
});

test('AST engine does not flag comments or string literals as executable findings', () => {
  const source = `// console.log("not executable")
const text = "dangerouslySetInnerHTML";
export const Component = () => <img alt="" src="/decorative.svg" />;`;
  const result = analyzeSource('src/Safe.jsx', source);
  assert.equal(result.findings.length, 0);
});

test('AST engine detects raw HTML insertion and debug calls by syntax', () => {
  const source = `export function Unsafe({ html }) {
  console.log("debug");
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}`;
  const result = analyzeSource('src/Unsafe.jsx', source);
  assert.deepEqual(result.findings.map(item => item.rule_id).sort(), [
    'javascript/no-debugger-console',
    'react/security/raw-html'
  ]);
});

test('AST engine detects explicit any in TypeScript and supports TSX', () => {
  const source = `type Props = { value: any };
export function Example({ value }: Props) {
  return <img src={String(value)} alt="Example" />;
}`;
  const result = analyzeSource('src/Example.tsx', source);
  assert.equal(result.parse_error, null);
  assert.ok(result.findings.some(item => item.rule_id === 'typescript/no-explicit-any'));
});

test('finding identifiers are stable for unchanged source and context', () => {
  const source = 'export const Example = () => <img src="/x.svg" />;';
  const first = analyzeSource('src/Example.jsx', source).findings;
  const second = analyzeSource('src/Example.jsx', source).findings;
  assert.deepEqual(first.map(item => item.id), second.map(item => item.id));
  assert.match(first[0].id, /^RRA-[A-F0-9]{12}$/);
});

test('syntax errors are explicit and are not converted into heuristic findings', () => {
  const result = analyzeSource('src/Broken.jsx', 'export const = ;');
  assert.equal(result.findings.length, 0);
  assert.equal(result.skipped_reason, 'parse_error');
  assert.ok(result.parse_error.message.length > 0);
});

test('finding summaries expose stable severity and category counts', () => {
  const findings = analyzeSource('src/Example.jsx', '<img src="/x.svg" />').findings;
  const summary = summarizeFindings(findings);
  assert.equal(summary.total, 1);
  assert.equal(summary.by_severity.Medium, 1);
  assert.equal(summary.by_category.Accessibility, 1);
});

test('isolated analysis worker returns AST findings through the parent runner', async () => {
  const runner = createAnalysisRunner();
  try {
    const result = await runner.analyze('src/Worker.jsx', '<img src="/x.svg" />', 5000);
    assert.equal(result.timed_out, undefined);
    assert.ok(result.findings.some(item => item.rule_id === 'jsx/a11y/img-alt'));
  } finally {
    await runner.close();
  }
});

test('analysis runner terminates an unresponsive worker at its deadline', async () => {
  class UnresponsiveWorker extends EventEmitter {
    terminated = false;
    postMessage() {}
    async terminate() {
      this.terminated = true;
      return 1;
    }
  }

  let worker;
  const runner = createAnalysisRunner({
    workerFactory: () => {
      worker = new UnresponsiveWorker();
      return worker;
    }
  });
  const result = await runner.analyze('src/Slow.jsx', 'const value = 1;', 5);
  assert.equal(result.timed_out, true);
  assert.equal(result.skipped_reason, 'analysis_timeout');
  assert.equal(worker.terminated, true);
  await runner.close();
});
