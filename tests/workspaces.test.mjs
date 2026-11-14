import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { deflateRawSync } from 'node:zlib';
import test from 'node:test';
import { WorkspaceManager } from '../server/workspaces.mjs';

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeZip(files, { corruptCrc = false } = {}) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const content = Buffer.from(file.content ?? '', 'utf8');
    const compressed = deflateRawSync(content);
    const crc = (crc32(content) + (corruptCrc ? 1 : 0)) >>> 0;
    const flags = 0x0800;
    const method = 8;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt32LE((file.mode ?? 0o100644) * 0x10000, 38);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, name);
    localOffset += local.length + name.length + compressed.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

async function withManager(run, options) {
  const manager = new WorkspaceManager(options);
  try { await run(manager); } finally { await manager.close(); }
}

test('workspace extracts bounded ZIP files and enforces owner isolation', async () => {
  await withManager(async manager => {
    const archive = makeZip([{ name: 'src/App.jsx', content: 'export default function App() { return null; }' }]);
    const created = await manager.createFromZip('user-a', archive);
    assert.equal(created.file_count, 1);
    assert.ok(created.workspace_id);
    assert.ok(Date.parse(created.expires_at) > Date.now());
    const root = await manager.resolve('user-a', created.workspace_id);
    assert.equal(await readFile(root + '/src/App.jsx', 'utf8'), 'export default function App() { return null; }');
    await assert.rejects(manager.resolve('user-b', created.workspace_id), /not found or access denied/);
    assert.equal(await manager.delete('user-b', created.workspace_id), false);
    assert.equal(await manager.delete('user-a', created.workspace_id), true);
    await assert.rejects(manager.resolve('user-a', created.workspace_id), /not found or access denied/);
  });
});

test('workspace rejects parent traversal and absolute archive paths', async () => {
  await withManager(async manager => {
    await assert.rejects(manager.createFromZip('user-a', makeZip([{ name: '../outside.txt', content: 'x' }])), /path traversal/);
    await assert.rejects(manager.createFromZip('user-a', makeZip([{ name: '/etc/passwd', content: 'x' }])), /absolute path/);
    await assert.rejects(manager.createFromZip('user-a', makeZip([{ name: 'C:/outside.txt', content: 'x' }])), /absolute path/);
  });
});

test('workspace rejects symlinks, duplicate names, and invalid CRC values', async () => {
  await withManager(async manager => {
    await assert.rejects(manager.createFromZip('user-a', makeZip([{ name: 'escape', content: 'target', mode: 0o120777 }])), /link or special filesystem entry/);
    await assert.rejects(manager.createFromZip('user-a', makeZip([
      { name: 'src/App.jsx', content: 'a' }, { name: 'src/app.jsx', content: 'b' }
    ])), /duplicate paths/);
    await assert.rejects(manager.createFromZip('user-a', makeZip([{ name: 'src/App.jsx', content: 'source' }], { corruptCrc: true })), /checksum validation failed/);
  });
});

test('workspace enforces archive, file, and expanded-size limits', async () => {
  await withManager(async manager => {
    await assert.rejects(manager.createFromZip('user-a', Buffer.alloc(21)), /valid ZIP|size is outside/);
    await assert.rejects(manager.createFromZip('user-a', makeZip([{ name: 'large.txt', content: 'x'.repeat(500_001) }])), /exceeds the permitted size/);
  }, { limits: { maxArchiveBytes: 20, maxFileBytes: 16 } });
});

test('workspace quota and expiration cleanup are enforced', async () => {
  await withManager(async manager => {
    const archive = makeZip([{ name: 'README.md', content: 'demo' }]);
    const first = await manager.createFromZip('user-a', archive);
    await assert.rejects(manager.createFromZip('user-a', archive), /quota has been reached/);
    await manager.cleanupExpired(Date.now() + 10_000);
    await assert.rejects(manager.resolve('user-a', first.workspace_id), /not found or access denied/);
    const second = await manager.createFromZip('user-a', archive);
    assert.ok(second.workspace_id);
  }, { limits: { maxWorkspacesPerUser: 1, ttlMs: 5 } });
});

test('workspace manager refuses missing authenticated identities', async () => {
  await withManager(async manager => {
    await assert.rejects(manager.createFromZip('', makeZip([{ name: 'a.txt', content: 'a' }])), /identity is required/);
    await assert.rejects(manager.resolve('', '00000000-0000-0000-0000-000000000000'), /identity is required/);
  });
});
