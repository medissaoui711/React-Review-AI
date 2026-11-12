import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createReviewService } from '../server/review.mjs';

async function withProject(run) {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'react-review-ai-'));
  const root = path.join(parent, 'project');
  const outside = path.join(parent, 'outside.jsx');
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(outside, 'export default function Outside() { return null; }\n');
  try {
    const review = await createReviewService(root);
    await run({ parent, root, outside, review });
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
}

test('review service requires a configured absolute project root', async () => {
  await assert.rejects(createReviewService(undefined), /REACT_REVIEW_ROOT must be set/);
  await assert.rejects(createReviewService('relative/project'), /must be an absolute path/);
});

test('review service rejects a missing or non-directory root', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'react-review-ai-root-'));
  const file = path.join(parent, 'not-a-directory');
  await writeFile(file, 'not a directory');
  try {
    await assert.rejects(createReviewService(path.join(parent, 'missing')), /existing accessible directory/);
    await assert.rejects(createReviewService(file), /must point to a directory/);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test('reviewFile accepts a source file inside the configured project root', async () => {
  await withProject(async ({ root, review }) => {
    const source = 'export function Example() { return <img src="/logo.svg" />; }\n';
    await writeFile(path.join(root, 'src', 'Example.jsx'), source);

    const result = await review.reviewFile('src/Example.jsx');

    assert.equal(result.file, 'src/Example.jsx');
    assert.equal(result.mode, 'read-only heuristic');
    assert.ok(Array.isArray(result.findings));
    assert.equal(await readFile(path.join(root, 'src', 'Example.jsx'), 'utf8'), source);
  });
});

test('reviewFile rejects relative path traversal outside the configured root', async () => {
  await withProject(async ({ review }) => {
    await assert.rejects(review.reviewFile('../outside.jsx'), /Path is outside project root/);
  });
});

test('reviewFile rejects absolute paths even when the target exists', async () => {
  await withProject(async ({ outside, review }) => {
    await assert.rejects(review.reviewFile(outside), /Absolute file paths are not allowed/);
  });
});

test('reviewFile rejects a symlink that resolves outside the configured root', async () => {
  await withProject(async ({ root, outside, review }) => {
    await symlink(outside, path.join(root, 'src', 'escape.jsx'));
    await assert.rejects(review.reviewFile('src/escape.jsx'), /Resolved path is outside project root/);
  });
});

test('project inventory ignores a package.json symlink that points outside the root', async () => {
  await withProject(async ({ root, outside, review }) => {
    await symlink(outside, path.join(root, 'package.json'));
    const result = await review.reviewProject();
    assert.equal(result.detected.react, false);
    assert.equal(result.project_scope, 'configured trusted project root');
    assert.equal('project_root' in result, false);
  });
});

test('all review operations stay bound to the configured root and do not modify source files', async () => {
  await withProject(async ({ root, review }) => {
    const file = path.join(root, 'src', 'stable.jsx');
    const original = 'export const stable = true;\n';
    await writeFile(file, original);

    await review.reviewProject();
    await review.testAudit();
    await review.accessibilityAudit();

    assert.equal(await readFile(file, 'utf8'), original);
  });
});
