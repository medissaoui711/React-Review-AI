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
    assert.equal(response.status, 403);
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
