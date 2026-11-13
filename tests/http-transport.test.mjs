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
    await run({ endpoint: `http://127.0.0.1:${address.port}/mcp` });
  } finally {
    await runtime.close();
    if (previousRoot === undefined) delete process.env.REACT_REVIEW_ROOT;
    else process.env.REACT_REVIEW_ROOT = previousRoot;
    await rm(parent, { recursive: true, force: true });
  }
}

test('HTTP server applies explicit keep-alive and shutdown timeout limits', () => {
  const previousRoot = process.env.REACT_REVIEW_ROOT;
  const runtime = createHttpServer({
    ...process.env,
    REACT_REVIEW_ROOT: previousRoot || process.cwd(),
    MCP_SHUTDOWN_TIMEOUT_MS: '2500'
  });
  try {
    assert.equal(runtime.server.keepAliveTimeout, 5000);
    assert.equal(runtime.server.maxRequestsPerSocket, 1000);
  } finally {
    void runtime.close();
  }
});

test('HTTP server rejects invalid graceful-shutdown timeout configuration', () => {
  assert.throws(
    () => createHttpServer({ MCP_SHUTDOWN_TIMEOUT_MS: '0' }),
    /MCP_SHUTDOWN_TIMEOUT_MS must be a positive integer/
  );
});

test('health and readiness endpoints return minimal operational status', async () => {
  await withHttpServer(async ({ endpoint }) => {
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
