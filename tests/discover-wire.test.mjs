import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';
import path from 'node:path';

test('modern server/discover wire response follows the 2026-07-28 result envelope', { timeout: 10_000 }, async t => {
  const serverPath = path.resolve('server/index.mjs');
  const child = spawn(process.execPath, [serverPath], {
    env: { ...process.env, REACT_REVIEW_ROOT: process.cwd() },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { stderr += chunk; });
  t.after(() => {
    if (!child.killed) child.kill('SIGTERM');
  });

  const request = {
    jsonrpc: '2.0',
    id: 'discover-wire-test',
    method: 'server/discover',
    params: {
      _meta: {
        'io.modelcontextprotocol/protocolVersion': '2026-07-28',
        'io.modelcontextprotocol/clientInfo': { name: 'react-review-ai-wire-test', version: '1.0.0' },
        'io.modelcontextprotocol/clientCapabilities': {}
      }
    }
  };

  const responseLine = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for server/discover. stderr: ${stderr}`)), 5000);
    child.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      output += chunk;
      const line = output.split(/\r?\n/).find(value => value.trim());
      if (line) {
        clearTimeout(timer);
        resolve(line);
      }
    });
    child.stdin.write(JSON.stringify(request) + '\n');
  });

  child.stdin.end();
  const response = JSON.parse(responseLine);
  assert.equal(response.id, request.id);
  assert.equal(response.jsonrpc, '2.0');
  assert.equal(response.result?.resultType, 'complete', 'resultType must be inside result');
  assert.ok(response.result?.supportedVersions?.includes('2026-07-28'),
    'server/discover must advertise the exact modern protocol revision');
  assert.ok(response.result?._meta?.['io.modelcontextprotocol/serverInfo'],
    'server identity metadata must be inside result._meta');
  assert.equal(response.resultType, undefined, 'resultType must not be a top-level JSON-RPC member');
  assert.equal(response._meta, undefined, 'serverInfo metadata must not be a top-level JSON-RPC member');
});
