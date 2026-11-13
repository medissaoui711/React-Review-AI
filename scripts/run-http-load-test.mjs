import assert from 'node:assert/strict';
import os from 'node:os';
import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

function readOptions(argv) {
  const values = Object.fromEntries(argv.filter(item => item.startsWith('--'))
    .map(item => {
      const index = item.indexOf('=');
      return index < 0 ? [item.slice(2), 'true'] : [item.slice(2, index), item.slice(index + 1)];
    }));
  const options = {
    url: values.url,
    requests: Number(values.requests ?? 120),
    concurrency: Number(values.concurrency ?? 12),
    timeoutMs: Number(values['timeout-ms'] ?? 5000),
    maxP95Ms: Number(values['max-p95-ms'] ?? 1000)
  };
  if (!options.url) throw new Error('--url is required');
  const url = new URL(options.url);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('--url must use HTTP or HTTPS');
  for (const [name, value] of Object.entries({
    requests: options.requests, concurrency: options.concurrency,
    'timeout-ms': options.timeoutMs, 'max-p95-ms': options.maxP95Ms
  })) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`--${name} must be a positive integer`);
  }
  if (options.requests > 250 || options.concurrency > 32) {
    throw new Error('Synthetic load is bounded to 250 requests and 32 concurrent workers');
  }
  return options;
}

function percentile(values, fraction) {
  if (values.length === 0) return null;
  return values[Math.min(values.length - 1, Math.ceil(values.length * fraction) - 1)];
}

const options = readOptions(process.argv.slice(2));
const latencies = [];
const failures = [];
let nextRequest = 0;
const startedAt = performance.now();

async function worker() {
  while (true) {
    const index = nextRequest++;
    if (index >= options.requests) return;
    const requestStarted = performance.now();
    try {
      const response = await fetch(options.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: `load-${index + 1}`,
          method: 'tools/list',
          params: {
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientInfo': { name: 'react-review-ai-load-test', version: '1.0.0' },
              'io.modelcontextprotocol/clientCapabilities': {}
            }
          }
        }),
        signal: AbortSignal.timeout(options.timeoutMs)
      });
      const rawBody = await response.text();
      assert.equal(response.status, 200, `HTTP status ${response.status}: ${rawBody.slice(0, 300)}`);
      const body = JSON.parse(rawBody);
      assert.equal(body.jsonrpc, '2.0');
      assert.equal(body.result?.resultType, 'complete');
      assert.deepEqual(body.result?.tools?.map(tool => tool.name).sort(), [
        'audit_accessibility', 'review_component', 'review_project', 'run_test_audit'
      ]);
      latencies.push(performance.now() - requestStarted);
    } catch (error) {
      failures.push({ request: index + 1, error: String(error?.message ?? error).slice(0, 240) });
    }
  }
}

await Promise.all(Array.from({ length: options.concurrency }, () => worker()));
const elapsedMs = performance.now() - startedAt;
latencies.sort((a, b) => a - b);
const succeeded = latencies.length;
const failed = failures.length;
const report = {
  node: process.version,
  platform: process.platform,
  architecture: process.arch,
  cpu_count: os.availableParallelism?.() ?? os.cpus().length,
  url_path: new URL(options.url).pathname,
  requests: options.requests,
  concurrency: options.concurrency,
  succeeded,
  failed,
  error_rate: failed / options.requests,
  elapsed_ms: Number(elapsedMs.toFixed(2)),
  throughput_requests_per_second: Number((succeeded / (elapsedMs / 1000)).toFixed(2)),
  latency_ms: {
    p50: Number((percentile(latencies, 0.50) ?? 0).toFixed(2)),
    p95: Number((percentile(latencies, 0.95) ?? 0).toFixed(2)),
    p99: Number((percentile(latencies, 0.99) ?? 0).toFixed(2)),
    max: Number((latencies.at(-1) ?? 0).toFixed(2))
  },
  max_p95_ms: options.maxP95Ms,
  failures,
  certification_note: 'Bounded local CI regression load only; not a production capacity or soak-test claim.'
};

await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/http-load-benchmark.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (failed > 0 || report.latency_ms.p95 > options.maxP95Ms) {
  process.exitCode = 1;
}
