import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
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
  for (const [fileIndex, file] of files.entries()) {
    const name = Buffer.from(file.name, 'utf8');
    const content = Buffer.from(file.content ?? '', 'utf8');
    const compressed = deflateRawSync(content);
    const corruptThisCrc = corruptCrc === true || corruptCrc === fileIndex;
    const crc = (crc32(content) + (corruptThisCrc ? 1 : 0)) >>> 0;
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
    await assert.rejects(manager.createFromZip('user-a', Buffer.alloc(1_000_001)), /size is outside the permitted limit/);
    await assert.rejects(manager.createFromZip('user-a', Buffer.alloc(21)), /valid ZIP|size is outside/);
    await assert.rejects(manager.createFromZip('user-a', makeZip([{ name: 'large.txt', content: 'x'.repeat(500_001) }])), /exceeds the permitted size/);
  }, { limits: { maxArchiveBytes: 1_000_000, maxFileBytes: 16 } });
});

test('workspace quota and expiration cleanup are enforced', async () => {
  await withManager(async manager => {
    const archive = makeZip([{ name: 'README.md', content: 'demo' }]);
    const first = await manager.createFromZip('user-a', archive);
    await assert.rejects(manager.createFromZip('user-a', archive), /quota has been reached/);
    await manager.cleanupExpired(Date.now() + 120_000);
    await assert.rejects(manager.resolve('user-a', first.workspace_id), /not found or access denied/);
    const second = await manager.createFromZip('user-a', archive);
    assert.ok(second.workspace_id);
  }, { limits: { maxWorkspacesPerUser: 1, ttlMs: 60_000 } });
});

test('concurrent uploads cannot exceed the per-user workspace quota', async () => {
  await withManager(async manager => {
    const archive = makeZip([{ name: 'README.md', content: 'demo' }]);
    const results = await Promise.allSettled([
      manager.createFromZip('user-a', archive),
      manager.createFromZip('user-a', archive)
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter(result => result.status === 'rejected').length, 1);
    assert.match(results.find(result => result.status === 'rejected').reason.message, /quota has been reached/);
  }, { limits: { maxWorkspacesPerUser: 1 } });
});

test('global process workspace capacity is enforced across different users', async () => {
  await withManager(async manager => {
    const archive = makeZip([{ name: 'README.md', content: 'demo' }]);
    await manager.createFromZip('user-a', archive);
    await assert.rejects(manager.createFromZip('user-b', archive), /server workspace capacity has been reached/);
  }, { limits: { maxWorkspacesTotal: 1 } });
});

test('workspace manager refuses missing authenticated identities', async () => {
  await withManager(async manager => {
    await assert.rejects(manager.createFromZip('', makeZip([{ name: 'a.txt', content: 'a' }])), /identity is required/);
    await assert.rejects(manager.resolve('', '00000000-0000-0000-0000-000000000000'), /identity is required/);
  });
});


function locateEnd(archive) {
  for (let offset = archive.length - 22; offset >= Math.max(0, archive.length - 65_557); offset -= 1) {
    if (archive.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error('Test ZIP has no EOCD.');
}

function patchCentral(archive, patch) {
  const copy = Buffer.from(archive);
  const end = locateEnd(copy);
  const centralOffset = copy.readUInt32LE(end + 16);
  patch(copy, centralOffset, end);
  return copy;
}

test('workspace rejects unsupported, encrypted, multi-volume, and ZIP64 archives', async () => {
  await withManager(async manager => {
    const archive = makeZip([{ name: 'a.txt', content: 'a' }]);
    await assert.rejects(manager.createFromZip('user-a', patchCentral(archive, (copy, central) => {
      copy.writeUInt16LE(99, central + 10);
      copy.writeUInt16LE(99, 8);
    })), /unsupported compression method/);
    await assert.rejects(manager.createFromZip('user-a', patchCentral(archive, (copy, central) => {
      copy.writeUInt16LE(copy.readUInt16LE(central + 8) | 1, central + 8);
      copy.writeUInt16LE(copy.readUInt16LE(6) | 1, 6);
    })), /Encrypted ZIP entries/);
    await assert.rejects(manager.createFromZip('user-a', patchCentral(archive, (copy, central, end) => {
      copy.writeUInt16LE(1, end + 4);
    })), /Multi-volume ZIP/);
    await assert.rejects(manager.createFromZip('user-a', patchCentral(archive, (copy, central, end) => {
      copy.writeUInt16LE(0xffff, end + 8);
      copy.writeUInt16LE(0xffff, end + 10);
    })), /ZIP64/);
  });
});

test('workspace rejects local and central header mismatches and truncated entry data', async () => {
  await withManager(async manager => {
    const archive = makeZip([{ name: 'src/App.jsx', content: 'source code' }]);
    await assert.rejects(manager.createFromZip('user-a', patchCentral(archive, copy => {
      copy.writeUInt16LE(copy.readUInt16LE(6) ^ 0x0800, 6);
    })), /local and central headers do not match/);
    await assert.rejects(manager.createFromZip('user-a', patchCentral(archive, (copy, central) => {
      const expandedCompressedSize = copy.readUInt32LE(central + 20) + 500;
      copy.writeUInt32LE(expandedCompressedSize, central + 20);
      copy.writeUInt32LE(expandedCompressedSize, 18);
    })), /truncated or overlaps its directory/);
    await assert.rejects(manager.createFromZip('user-a', patchCentral(archive, copy => {
      copy.writeUInt32LE(0, 0);
    })), /local file header is malformed/);
  });
});

test('workspace rejects deflate streams that expand beyond their declared size', async () => {
  await withManager(async manager => {
    const archive = makeZip([{ name: 'bomb.txt', content: 'A'.repeat(100_000) }]);
    const malicious = patchCentral(archive, (copy, central) => {
      copy.writeUInt32LE(1, central + 24);
      copy.writeUInt32LE(1, 22);
    });
    await assert.rejects(manager.createFromZip('user-a', malicious));
  });
});

test('workspace enforces entry-count and path-depth limits before extraction', async () => {
  await withManager(async manager => {
    const tooMany = makeZip([
      { name: 'one.txt', content: '1' },
      { name: 'two.txt', content: '2' },
      { name: 'three.txt', content: '3' }
    ]);
    await assert.rejects(manager.createFromZip('user-a', tooMany), /entry or directory limits/);
    await assert.rejects(manager.createFromZip('user-a', makeZip([
      { name: 'a/b/c/d.txt', content: 'x' }
    ])), /directory depth/);
  }, { limits: { maxEntries: 2, maxDepth: 3 } });
});

test('workspace rejects malformed archive filenames and normalized duplicates', async () => {
  await withManager(async manager => {
    await assert.rejects(manager.createFromZip('user-a', makeZip([{ name: 'src\\\\App.jsx', content: 'x' }])), /invalid path/);
    await assert.rejects(manager.createFromZip('user-a', makeZip([{ name: 'src/./App.jsx', content: 'x' }])), /path traversal/);
    await assert.rejects(manager.createFromZip('user-a', makeZip([
      { name: 'caf\u00e9.txt', content: 'a' },
      { name: 'cafe\u0301.txt', content: 'b' }
    ])), /duplicate paths/);
  });
});

test('concurrent uploads across distinct users cannot exceed global capacity', async () => {
  await withManager(async manager => {
    const archive = makeZip([{ name: 'README.md', content: 'demo' }]);
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, index) => manager.createFromZip('user-' + index, archive))
    );
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 5);
    assert.equal(results.filter(result => result.status === 'rejected').length, 15);
    for (const result of results.filter(item => item.status === 'rejected')) {
      assert.match(result.reason.message, /server workspace capacity has been reached/);
    }
  }, { limits: { maxWorkspacesTotal: 5, maxWorkspacesPerUser: 1 } });
});

test('failed extraction removes partial workspace files and private permissions are restrictive', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'react-review-ai-workspace-security-'));
  const manager = new WorkspaceManager({ root: parent });
  try {
    const archive = makeZip([
      { name: 'src/First.jsx', content: 'first' },
      { name: 'src/Second.jsx', content: 'second' }
    ], { corruptCrc: 1 });
    await assert.rejects(manager.createFromZip('user-a', archive), /checksum validation failed/);
    const roots = await readdir(parent);
    assert.equal(roots.length, 1);
    const privateRoot = path.join(parent, roots[0]);
    assert.equal((await stat(privateRoot)).mode & 0o077, 0);
    const valid = await manager.createFromZip('user-a', makeZip([{ name: 'src/App.jsx', content: 'ok' }]));
    const workspaceRoot = await manager.resolve('user-a', valid.workspace_id);
    assert.equal((await stat(workspaceRoot)).mode & 0o077, 0);
    assert.equal((await stat(path.join(workspaceRoot, 'src/App.jsx'))).mode & 0o077, 0);
  } finally {
    await manager.close();
    await rm(parent, { recursive: true, force: true });
  }
});

test('workspace manager close is idempotent, removes temporary data, and rejects later use', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'react-review-ai-workspace-close-'));
  const manager = new WorkspaceManager({ root: parent });
  const archive = makeZip([{ name: 'README.md', content: 'temporary' }]);
  try {
    await manager.createFromZip('user-a', archive);
    const roots = await readdir(parent);
    assert.equal(roots.length, 1);
    await manager.close();
    await manager.close();
    assert.deepEqual(await readdir(parent), []);
    await assert.rejects(manager.createFromZip('user-a', archive), /manager is closed/);
    await assert.rejects(manager.resolve('user-a', '00000000-0000-0000-0000-000000000000'), /manager is closed/);
  } finally {
    await manager.close();
    await rm(parent, { recursive: true, force: true });
  }
});
