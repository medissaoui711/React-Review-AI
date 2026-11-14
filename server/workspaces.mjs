import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';

const DEFAULT_LIMITS = Object.freeze({
  maxArchiveBytes: 20_000_000,
  maxEntries: 2_500,
  maxFileBytes: 500_000,
  maxTotalBytes: 20_000_000,
  ttlMs: 30 * 60_000,
  maxWorkspacesPerUser: 3,
  maxDepth: 20
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function safeArchivePath(rawName) {
  if (!rawName || rawName.includes('\\') || rawName.includes('\0')) throw new Error('Archive contains an invalid path.');
  if (rawName.startsWith('/') || /^[a-zA-Z]:/.test(rawName)) throw new Error('Archive contains an absolute path.');
  const isDirectory = rawName.endsWith('/');
  const normalized = isDirectory ? rawName.slice(0, -1) : rawName;
  const segments = normalized.split('/');
  if (!normalized || segments.some(segment => !segment || segment === '.' || segment === '..')) {
    throw new Error('Archive contains a path traversal entry.');
  }
  if (segments.some(segment => segment.length > 255)) throw new Error('Archive contains an overlong path segment.');
  if (segments.length > 20) throw new Error('Archive path exceeds the permitted directory depth.');
  return { relativePath: segments.join(path.sep), isDirectory };
}

function findEndOfCentralDirectory(archive) {
  const minimum = Math.max(0, archive.length - 65_557);
  for (let offset = archive.length - 22; offset >= minimum; offset -= 1) {
    if (archive.readUInt32LE(offset) === 0x06054b50) {
      const commentLength = archive.readUInt16LE(offset + 20);
      if (offset + 22 + commentLength === archive.length) return offset;
    }
  }
  throw new Error('Archive is not a valid ZIP file.');
}

function readZipEntries(archive, limits) {
  if (!Buffer.isBuffer(archive) || archive.length < 22 || archive.length > limits.maxArchiveBytes) {
    throw new Error('Archive size is outside the permitted limit.');
  }
  const eocd = findEndOfCentralDirectory(archive);
  const disk = archive.readUInt16LE(eocd + 4);
  const centralDisk = archive.readUInt16LE(eocd + 6);
  const diskEntries = archive.readUInt16LE(eocd + 8);
  const entryCount = archive.readUInt16LE(eocd + 10);
  const centralSize = archive.readUInt32LE(eocd + 12);
  const centralOffset = archive.readUInt32LE(eocd + 16);
  if (disk !== 0 || centralDisk !== 0 || diskEntries !== entryCount) throw new Error('Multi-volume ZIP archives are not supported.');
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new Error('ZIP64 archives are not supported.');
  }
  if (entryCount > limits.maxEntries || centralOffset + centralSize > eocd) {
    throw new Error('Archive exceeds the permitted entry or directory limits.');
  }

  const decoder = new TextDecoder('utf-8', { fatal: true });
  const entries = [];
  const names = new Set();
  let offset = centralOffset;
  let totalBytes = 0;

  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > archive.length || archive.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error('Archive central directory is malformed.');
    }
    const madeBy = archive.readUInt16LE(offset + 4);
    const flags = archive.readUInt16LE(offset + 8);
    const method = archive.readUInt16LE(offset + 10);
    const expectedCrc = archive.readUInt32LE(offset + 16);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const uncompressedSize = archive.readUInt32LE(offset + 24);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const startDisk = archive.readUInt16LE(offset + 34);
    const externalAttributes = archive.readUInt32LE(offset + 38);
    const localOffset = archive.readUInt32LE(offset + 42);
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (end > archive.length || startDisk !== 0 || compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
      throw new Error('ZIP64 or malformed archive entries are not supported.');
    }
    if ((flags & 1) !== 0 || (flags & 0x40) !== 0) throw new Error('Encrypted ZIP entries are not supported.');
    if (method !== 0 && method !== 8) throw new Error('Archive uses an unsupported compression method.');
    const rawName = decoder.decode(archive.subarray(offset + 46, offset + 46 + nameLength));
    const safe = safeArchivePath(rawName);
    const key = safe.relativePath.toLowerCase();
    if (names.has(key)) throw new Error('Archive contains duplicate paths.');
    names.add(key);

    const hostSystem = madeBy >>> 8;
    const unixMode = hostSystem === 3 ? externalAttributes >>> 16 : 0;
    const fileType = unixMode & 0xf000;
    if (fileType === 0xa000 || (fileType !== 0 && fileType !== 0x8000 && fileType !== 0x4000)) {
      throw new Error('Archive contains a link or special filesystem entry.');
    }
    if ((fileType === 0x4000) !== safe.isDirectory && fileType !== 0) {
      throw new Error('Archive entry type does not match its path.');
    }
    if (safe.isDirectory && uncompressedSize !== 0) throw new Error('Archive directory entries must be empty.');
    if (!safe.isDirectory && (uncompressedSize > limits.maxFileBytes || uncompressedSize > limits.maxTotalBytes)) {
      throw new Error('An archive file exceeds the permitted size.');
    }
    totalBytes += uncompressedSize;
    if (totalBytes > limits.maxTotalBytes) throw new Error('Archive expands beyond the permitted total size.');

    entries.push({
      ...safe, rawName, flags, expectedCrc, compressedSize, uncompressedSize, method, localOffset, centralOffset
    });
    offset = end;
  }
  if (offset !== centralOffset + centralSize) throw new Error('Archive central directory size does not match its entries.');
  return entries;
}

function extractEntry(archive, entry) {
  const offset = entry.localOffset;
  if (offset + 30 > archive.length || archive.readUInt32LE(offset) !== 0x04034b50) {
    throw new Error('Archive local file header is malformed.');
  }
  const localFlags = archive.readUInt16LE(offset + 6);
  const localMethod = archive.readUInt16LE(offset + 8);
  const nameLength = archive.readUInt16LE(offset + 26);
  const extraLength = archive.readUInt16LE(offset + 28);
  const localName = new TextDecoder('utf-8', { fatal: true }).decode(archive.subarray(offset + 30, offset + 30 + nameLength));
  if (localName !== entry.rawName || localMethod !== entry.method || localFlags !== entry.flags) {
    throw new Error('Archive local and central headers do not match.');
  }
  const dataStart = offset + 30 + nameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > entry.centralOffset || dataEnd > archive.length) throw new Error('Archive entry data is truncated or overlaps its directory.');
  const compressed = archive.subarray(dataStart, dataEnd);
  const output = entry.method === 0
    ? Buffer.from(compressed)
    : inflateRawSync(compressed, { maxOutputLength: Math.max(1, entry.uncompressedSize) });
  if (output.length !== entry.uncompressedSize || crc32(output) !== entry.expectedCrc) {
    throw new Error('Archive entry size or checksum validation failed.');
  }
  return output;
}

export class WorkspaceManager {
  #rootPromise;
  #workspaces = new Map();
  #creatingByUser = new Map();
  #limits;
  #sweepTimer;
  #closed = false;

  constructor({ root = os.tmpdir(), limits = {} } = {}) {
    this.#limits = Object.freeze({ ...DEFAULT_LIMITS, ...limits });
    this.#rootPromise = mkdtemp(path.join(root, 'react-review-ai-workspaces-'));
    this.#sweepTimer = setInterval(() => { this.cleanupExpired().catch(() => {}); }, 60_000);
    this.#sweepTimer.unref?.();
  }

  async ready() {
    if (this.#closed) return false;
    try { await this.#rootPromise; return true; } catch { return false; }
  }

  async createFromZip(userId, archive) {
    if (this.#closed) throw new Error('Workspace manager is closed.');
    if (typeof userId !== 'string' || !userId.trim()) throw new Error('Authenticated user identity is required.');
    const entries = readZipEntries(archive, this.#limits);
    await this.cleanupExpired();
    const activeForUser = [...this.#workspaces.values()].filter(item => item.userId === userId).length;
    const creating = this.#creatingByUser.get(userId) ?? 0;
    if (activeForUser + creating >= this.#limits.maxWorkspacesPerUser) {
      throw new Error('The user workspace quota has been reached.');
    }
    this.#creatingByUser.set(userId, creating + 1);

    let workspacePath;
    try {
      const root = await this.#rootPromise;
      const id = randomUUID();
      workspacePath = path.join(root, id);
      await mkdir(workspacePath, { recursive: false, mode: 0o700 });
      for (const entry of entries) {
        const destination = path.resolve(workspacePath, entry.relativePath);
        if (destination !== workspacePath && !destination.startsWith(workspacePath + path.sep)) {
          throw new Error('Archive path escaped the workspace boundary.');
        }
        if (entry.isDirectory) {
          await mkdir(destination, { recursive: true, mode: 0o700 });
          continue;
        }
        await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
        const content = extractEntry(archive, entry);
        await writeFile(destination, content, { flag: 'wx', mode: 0o600 });
      }
      const realWorkspace = await realpath(workspacePath);
      const record = {
        id, userId, path: realWorkspace,
        createdAt: Date.now(),
        expiresAt: Date.now() + this.#limits.ttlMs
      };
      this.#workspaces.set(id, record);
      return Object.freeze({
        workspace_id: id,
        expires_at: new Date(record.expiresAt).toISOString(),
        file_count: entries.filter(entry => !entry.isDirectory).length,
        limits: {
          max_archive_bytes: this.#limits.maxArchiveBytes,
          max_entries: this.#limits.maxEntries,
          max_file_bytes: this.#limits.maxFileBytes,
          max_total_bytes: this.#limits.maxTotalBytes,
          ttl_ms: this.#limits.ttlMs
        }
      });
    } catch (error) {
      if (workspacePath) await rm(workspacePath, { recursive: true, force: true });
      throw error;
    } finally {
      const pending = (this.#creatingByUser.get(userId) ?? 1) - 1;
      if (pending > 0) this.#creatingByUser.set(userId, pending);
      else this.#creatingByUser.delete(userId);
    }
  }

  async resolve(userId, workspaceId) {
    if (this.#closed) throw new Error('Workspace manager is closed.');
    if (typeof userId !== 'string' || !userId || typeof workspaceId !== 'string' || !workspaceId) {
      throw new Error('A valid authenticated workspace identity is required.');
    }
    await this.cleanupExpired();
    const record = this.#workspaces.get(workspaceId);
    if (!record || record.userId !== userId) throw new Error('Workspace not found or access denied.');
    const root = await this.#rootPromise;
    const actual = await realpath(record.path);
    if (actual !== record.path || !actual.startsWith(root + path.sep)) {
      this.#workspaces.delete(workspaceId);
      throw new Error('Workspace integrity validation failed.');
    }
    return actual;
  }

  async delete(userId, workspaceId) {
    const record = this.#workspaces.get(workspaceId);
    if (!record || record.userId !== userId) return false;
    this.#workspaces.delete(workspaceId);
    await rm(record.path, { recursive: true, force: true });
    return true;
  }

  async cleanupExpired(now = Date.now()) {
    for (const [id, record] of this.#workspaces) {
      if (record.expiresAt <= now) {
        this.#workspaces.delete(id);
        await rm(record.path, { recursive: true, force: true });
      }
    }
  }

  async close() {
    if (this.#closed) return;
    this.#closed = true;
    clearInterval(this.#sweepTimer);
    this.#workspaces.clear();
    try { await rm(await this.#rootPromise, { recursive: true, force: true }); } catch { /* Temporary root may not have been created. */ }
  }
}
