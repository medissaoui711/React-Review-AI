import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createHttpServer } from '../server/http.mjs';

async function withHttpServer(run) {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'react-review-ai-http-'));
  const root = path.join(parent, 'project');
  await mkdir(root, { recursive: true });
  const previousRoot = process.env.REACT_REVIEW_ROOT;
  process.env.REACT_REVIEW_ROOT = root;
  const runtime = createHttpServer();

  try {
    await new Promise((resolve, reject) => {
      runtime.server.once('error', reject);
      runtime.server.listen(0, '127.0.0.1', resolve);
    });
    const address = runtime.server.address();
    await run({ endpoint: `http://127.0.0.1:${address.port}/mcp`, getMetrics: () => runtime.getMetrics() });
  } finally {
    await runtime.close();
    if (previousRoot === undefined) delete process.env.REACT_REVIEW_ROOT;
    else process.env.REACT_REVIEW_ROOT = previousRoot;
    await rm(parent, { recursive: true, force: true });
  }
}

test('HTTP server applies explicit keep-alive and accepts a shutdown timeout', async () => {
  const runtime = createHttpServer({
    REACT_REVIEW_ROOT: process.cwd(),
    MCP_SHUTDOWN_TIMEOUT_MS: '2500'
  });
  try {
    await new Promise((resolve, reject) => {
      runtime.server.once('error', reject);
      runtime.server.listen(0, '127.0.0.1', resolve);
    });
    assert.equal(runtime.server.keepAliveTimeout, 5000);
    assert.equal(runtime.server.maxRequestsPerSocket, 1000);
  } finally {
    await runtime.close();
  }
});

test('HTTP server bounds concurrent requests while keeping health probes available', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'react-review-ai-concurrency-'));
  const root = path.join(parent, 'project');
  await mkdir(root, { recursive: true });
  const runtime = createHttpServer({
    REACT_REVIEW_ROOT: root,
    MCP_MAX_CONCURRENT_REQUESTS: '1'
  });
  const abort = new AbortController();
  const hangingBody = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{}'));
    }
  });

  try {
    await new Promise((resolve, reject) => {
      runtime.server.once('error', reject);
      runtime.server.listen(0, '127.0.0.1', resolve);
    });
    const address = runtime.server.address();
    const base = `http://127.0.0.1:${address.port}`;
    const firstRequest = fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: hangingBody,
      duplex: 'half',
      signal: abort.signal
    }).catch(() => null);

    await new Promise(resolve => setTimeout(resolve, 50));
    const overloaded = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    });
    assert.equal(overloaded.status, 503);
    assert.equal(overloaded.headers.get('retry-after'), '1');

    const health = await fetch(`${base}/healthz`);
    assert.equal(health.status, 200);
    assert.ok(runtime.getMetrics().counters.http_overloaded_total >= 1);

    abort.abort();
    await firstRequest;
  } finally {
    abort.abort();
    await runtime.close();
    await rm(parent, { recursive: true, force: true });
  }
});

test('HTTP server rejects invalid graceful-shutdown and concurrency limits', () => {
  assert.throws(
    () => createHttpServer({ MCP_SHUTDOWN_TIMEOUT_MS: '0' }),
    /MCP_SHUTDOWN_TIMEOUT_MS must be a positive integer/
  );
  assert.throws(
    () => createHttpServer({ MCP_MAX_CONCURRENT_REQUESTS: '0' }),
    /MCP_MAX_CONCURRENT_REQUESTS must be a positive integer/
  );
});

test('HTTP request logs are correlated and never include authorization headers', async () => {
  const logs = [];
  const originalError = console.error;
  console.error = entry => logs.push(String(entry));
  try {
    await withHttpServer(async ({ endpoint }) => {
      const healthUrl = endpoint.replace('/mcp', '/healthz');
      const response = await fetch(healthUrl, {
        headers: { authorization: 'Bearer log-canary-secret' }
      });
      const requestId = response.headers.get('x-request-id');
      assert.match(requestId || '', /^[0-9a-f-]{36}$/i);
      assert.equal(response.status, 200);
      await response.text();
      await new Promise(resolve => setImmediate(resolve));

      const entries = logs.map(entry => JSON.parse(entry));
      const requestLog = entries.find(entry => entry.request_id === requestId);
      assert.ok(requestLog);
      assert.equal(requestLog.event, 'http_request');
      assert.equal(requestLog.route, 'health');
      assert.equal(requestLog.method, 'GET');
      assert.equal(typeof requestLog.duration_ms, 'number');
    });
  } finally {
    console.error = originalError;
  }
  assert.doesNotMatch(logs.join('\n'), /log-canary-secret|authorization|Bearer/i);
});

test('health and readiness endpoints return minimal operational status', async () => {
  await withHttpServer(async ({ endpoint, getMetrics }) => {
    const base = endpoint.slice(0, -'/mcp'.length);
    const health = await fetch(`${base}/healthz`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok' });
    assert.equal(health.headers.get('cache-control'), 'no-store');

    const ready = await fetch(`${base}/readyz`);
    assert.equal(ready.status, 200);
    assert.deepEqual(await ready.json(), { status: 'ready' });
    assert.equal(ready.headers.get('cache-control'), 'no-store');

    const wrongMethod = await fetch(`${base}/healthz`, { method: 'POST' });
    assert.equal(wrongMethod.status, 405);
    assert.equal(wrongMethod.headers.get('allow'), 'GET');
    await wrongMethod.text();
    const metrics = getMetrics();
    assert.equal(metrics.counters.http_requests_total, 3);
    assert.equal(metrics.http_requests_by_route.health, 3);
    assert.equal(metrics.http_requests_by_status_class['2xx'], 2);
    assert.equal(metrics.http_requests_by_status_class['4xx'], 1);
  });
});

test('readiness remains unavailable when the configured project root is invalid', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'react-review-ai-not-ready-'));
  const runtime = createHttpServer({ REACT_REVIEW_ROOT: path.join(parent, 'missing-project') });
  try {
    await new Promise((resolve, reject) => {
      runtime.server.once('error', reject);
      runtime.server.listen(0, '127.0.0.1', resolve);
    });
    const address = runtime.server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/readyz`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { status: 'not_ready' });
  } finally {
    await runtime.close();
    await rm(parent, { recursive: true, force: true });
  }
});

test('Streamable HTTP exposes one MCP endpoint and rejects unknown paths', async () => {
  await withHttpServer(async ({ endpoint }) => {
    const response = await fetch(endpoint.replace('/mcp', '/unknown'));
    assert.equal(response.status, 404);
  });
});

test('modern stateless Streamable HTTP rejects standalone GET and DELETE session operations', async () => {
  await withHttpServer(async ({ endpoint }) => {
    const getResponse = await fetch(endpoint, { method: 'GET' });
    const deleteResponse = await fetch(endpoint, { method: 'DELETE' });
    assert.equal(getResponse.status, 405);
    assert.equal(deleteResponse.status, 405);
  });
});

test('Streamable HTTP rejects untrusted browser origins before MCP processing', async () => {
  await withHttpServer(async ({ endpoint }) => {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        origin: 'https://untrusted.example'
      },
      body: '{}'
    });
    assert.equal(response.status, 403);
  });
});

test('Streamable HTTP rejects untrusted Host headers before MCP processing', async () => {
  await withHttpServer(async ({ endpoint }) => {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        host: 'untrusted.example',
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream'
      },
      body: '{}'
    });
    assert.ok([400, 403].includes(response.status), `Expected Host rejection, received HTTP ${response.status}`);
  });
});

test('Streamable HTTP accepts non-browser clients without an Origin header', async () => {
  await withHttpServer(async ({ endpoint }) => {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream'
      },
      body: '{}'
    });
    assert.notEqual(response.status, 403);
  });
});
