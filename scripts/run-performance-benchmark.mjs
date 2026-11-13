import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { createRuntimeMetrics } from '../server/metrics.mjs';
import { createReviewService } from '../server/review.mjs';

function readPositiveOption(name, fallback, maximum) {
  const prefix = `--${name}=`;
  const argument = process.argv.find(value => value.startsWith(prefix));
  const raw = argument ? argument.slice(prefix.length) : String(fallback);
  if (!/^\d+$/.test(raw)) throw new Error(`--${name} must be a positive integer.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`--${name} must be between 1 and ${maximum}.`);
  }
  return value;
}

async function main() {
  const fileCount = readPositiveOption('files', 100, 1000);
  const targetBytes = readPositiveOption('bytes', 1024, 100_000);
  const parent = await mkdtemp(path.join(os.tmpdir(), 'react-review-ai-benchmark-'));
  const root = path.join(parent, 'project');
  await mkdir(path.join(root, 'src'), { recursive: true });
  const metrics = createRuntimeMetrics();

  try {
    for (let index = 0; index < fileCount; index += 1) {
      const name = `Component${String(index + 1).padStart(4, '0')}`;
      const prefix = `export default function ${name}() { return <img src="/asset.svg" />; }\n`;
      const fillerLength = Math.max(0, targetBytes - Buffer.byteLength(prefix, 'utf8') - 5);
      const source = prefix + `/*${'x'.repeat(fillerLength)}*/\n`;
      await writeFile(path.join(root, 'src', `${name}.jsx`), source, 'utf8');
    }

    const review = await createReviewService(root, { metrics });
    const startedAt = performance.now();
    const result = await review.reviewProject();
    const elapsedMs = Number((performance.now() - startedAt).toFixed(2));
    const report = {
      benchmark: 'isolated-ast-project-scan',
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      cpu_count: typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length,
      generated_files: fileCount,
      target_bytes_per_file: targetBytes,
      elapsed_ms: elapsedMs,
      scanned_files: result.scanned_file_count,
      source_files: result.source_file_count,
      bytes_read: result.execution.bytes_read,
      findings: result.summary.total,
      parse_errors: result.parse_errors.length,
      timed_out: result.execution.timed_out,
      truncated: result.execution.truncated,
      rss_bytes: process.memoryUsage().rss,
      metrics: metrics.snapshot()
    };

    await mkdir('artifacts', { recursive: true });
    const output = JSON.stringify(report, null, 2) + '\n';
    await writeFile('artifacts/performance-benchmark.json', output, 'utf8');
    console.log(output);

    assert.equal(report.timed_out, false, 'synthetic scan exceeded the configured time budget');
    assert.equal(report.truncated, false, 'synthetic scan unexpectedly truncated');
    assert.equal(report.source_files, fileCount, 'not all generated source files were scanned');
    assert.equal(report.parse_errors, 0, 'synthetic source produced parse errors');
    assert.ok(report.findings >= fileCount, 'expected at least one finding per generated file');
    assert.ok(elapsedMs < 10_000, 'benchmark exceeded the configured 10-second scan ceiling');
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
