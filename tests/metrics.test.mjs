import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createRuntimeMetrics } from '../server/metrics.mjs';
import { createReviewService } from '../server/review.mjs';

test('analysis metrics count findings, parse errors, bytes and timeouts without file labels', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'react-review-ai-metrics-'));
  const root = path.join(parent, 'project');
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'src', 'App.jsx'), '<img src="/logo.svg" />\n', 'utf8');
  const metrics = createRuntimeMetrics();

  try {
    const review = await createReviewService(root, { metrics });
    const result = await review.reviewProject();
    assert.equal(result.summary.total, 1);

    const snapshot = metrics.snapshot();
    assert.equal(snapshot.counters.analysis_runs_total, 1);
    assert.equal(snapshot.counters.analysis_parse_errors_total, 0);
    assert.equal(snapshot.counters.analysis_findings_total, 1);
    assert.ok(snapshot.counters.analysis_bytes_total > 0);
    assert.ok(snapshot.counters.analysis_duration_ms_total >= 0);
    assert.equal(JSON.stringify(snapshot).includes('src/App.jsx'), false);

    snapshot.counters.analysis_runs_total = 999;
    assert.equal(metrics.snapshot().counters.analysis_runs_total, 1);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
