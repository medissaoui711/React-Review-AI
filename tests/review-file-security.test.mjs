import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { reviewFile } from '../server/review.mjs';

async function withProject(run) {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'react-review-ai-'));
  const root = path.join(parent, 'project');
  const outside = path.join(parent, 'outside.jsx');
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(outside, 'export default function Outside() { return null; }\n');
  try {
    await run({ parent, root, outside });
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
}

test('reviewFile accepts a source file inside the trusted project root', async () => {
  await withProject(async ({ root }) => {
    const source = 'export function Example() { return <img src="/logo.svg" />; }\n';
    await writeFile(path.join(root, 'src', 'Example.jsx'), source);

    const result = await reviewFile('src/Example.jsx', root);

    assert.equal(result.file, 'src/Example.jsx');
    assert.equal(result.mode, 'read-only heuristic');
    assert.ok(Array.isArray(result.findings));
    assert.equal(await readFile(path.join(root, 'src', 'Example.jsx'), 'utf8'), source);
  });
});

test('reviewFile rejects relative path traversal outside the project root', async () => {
  await withProject(async ({ root }) => {
    await assert.rejects(
      reviewFile('../outside.jsx', root),
      /Path is outside project root/,
    );
  });
});

test('reviewFile rejects absolute paths outside the project root', async () => {
  await withProject(async ({ root, outside }) => {
    await assert.rejects(
      reviewFile(outside, root),
      /Path is outside project root/,
    );
  });
});

test('reviewFile rejects a symlink that resolves outside the project root', async () => {
  await withProject(async ({ root, outside }) => {
    const linkPath = path.join(root, 'src', 'escape.jsx');
    await symlink(outside, linkPath);

    await assert.rejects(
      reviewFile('src/escape.jsx', root),
      /Resolved path is outside project root/,
    );
  });
});

test('reviewFile does not modify the reviewed source file', async () => {
  await withProject(async ({ root }) => {
    const file = path.join(root, 'src', 'stable.jsx');
    const original = 'export const stable = true;\n';
    await writeFile(file, original);

    await reviewFile('src/stable.jsx', root);

    assert.equal(await readFile(file, 'utf8'), original);
  });
});
