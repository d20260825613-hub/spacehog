import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';

/**
 * Content hashing used for duplicate detection.
 *
 * This is a *change detector*, not a security primitive: `md5` (the default)
 * is chosen because it is the fastest digest available in every Node build.
 * Do not use these hashes for anything security sensitive.
 */

export const HASH_ALGORITHMS = ['md5', 'sha1', 'sha256'];

/** Bytes read for the cheap "head" pass before committing to a full hash. */
export const DEFAULT_HEAD_BYTES = 64 * 1024;

export function isSupportedAlgorithm(name) {
  return HASH_ALGORITHMS.includes(String(name).toLowerCase());
}

/**
 * Hash the first `length` bytes of a file.
 * Files smaller than `length` are hashed completely (so head === full hash).
 */
export async function hashHead(filePath, algorithm = 'md5', length = DEFAULT_HEAD_BYTES) {
  const handle = await fsp.open(filePath, 'r');
  try {
    const buffer = Buffer.allocUnsafe(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    const slice = bytesRead === length ? buffer : buffer.subarray(0, bytesRead);
    return { hash: digest(algorithm, slice), bytesRead, complete: bytesRead < length };
  } finally {
    await handle.close();
  }
}

/** Hash an entire file using a streaming read (constant memory). */
export function hashFile(filePath, algorithm = 'md5') {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash(algorithm);
    const stream = fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 });
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function digest(algorithm, buffer) {
  return crypto.createHash(algorithm).update(buffer).digest('hex');
}

/* ------------------------------------------------------------------ *
 * Hash cache
 * ------------------------------------------------------------------ */

/**
 * A tiny JSON cache keyed by `path|size|mtimeMs` so repeat scans of a large
 * tree do not re-read unchanged files. Writes are atomic (tmp + rename).
 */
export class HashCache {
  constructor(storePath, { enabled, entries = new Map(), loaded = false } = {}) {
    this.storePath = storePath ?? null;
    // Explicit `enabled` wins; otherwise a store path means persistence.
    this.enabled = enabled === undefined ? Boolean(this.storePath) : Boolean(enabled);
    this.entries = entries;
    this.loaded = loaded;
    this.dirty = false;
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * @param {string|null} storePath file to read hashes from, or null for memory only
   * @param {{enabled?: boolean}} [options]
   */
  static async load(storePath, { enabled } = {}) {
    const cache = new HashCache(storePath, { enabled });
    if (!cache.enabled || !cache.storePath) return cache;
    try {
      const raw = await fsp.readFile(storePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && parsed.version === 1 && parsed.entries && typeof parsed.entries === 'object') {
        for (const [key, value] of Object.entries(parsed.entries)) {
          if (typeof value === 'string') cache.entries.set(key, value);
        }
      }
    } catch {
      /* missing or corrupt cache: start empty, silently */
    }
    cache.loaded = true;
    return cache;
  }

  static key(file, algorithm) {
    return `${algorithm}:${file.path}|${file.size}|${Math.floor(file.mtimeMs)}`;
  }

  get(file, algorithm) {
    if (!this.enabled) return null;
    const value = this.entries.get(HashCache.key(file, algorithm));
    if (value) this.hits += 1;
    else this.misses += 1;
    return value ?? null;
  }

  set(file, algorithm, hash) {
    if (!this.enabled) return;
    this.entries.set(HashCache.key(file, algorithm), hash);
    this.dirty = true;
  }

  async save({ maxEntries = 200_000 } = {}) {
    if (!this.enabled || !this.dirty) return { saved: false, entries: this.entries.size };
    // Keep the cache bounded: drop the oldest insertions first.
    if (this.entries.size > maxEntries) {
      const excess = this.entries.size - maxEntries;
      let i = 0;
      for (const key of this.entries.keys()) {
        if (i >= excess) break;
        this.entries.delete(key);
        i += 1;
      }
    }
    const payload = JSON.stringify({
      version: 1,
      updatedAt: new Date().toISOString(),
      entries: Object.fromEntries(this.entries),
    });
    const tmp = `${this.storePath}.${process.pid}.tmp`;
    try {
      await fsp.mkdir(storePathDir(this.storePath), { recursive: true });
      await fsp.writeFile(tmp, payload, 'utf8');
      await fsp.rename(tmp, this.storePath);
      return { saved: true, entries: this.entries.size };
    } catch {
      await fsp.rm(tmp, { force: true }).catch(() => {});
      return { saved: false, entries: this.entries.size };
    }
  }
}

function storePathDir(storePath) {
  const idx = Math.max(storePath.lastIndexOf('/'), storePath.lastIndexOf('\\'));
  return idx > 0 ? storePath.slice(0, idx) : '.';
}

/* ------------------------------------------------------------------ *
 * Concurrency
 * ------------------------------------------------------------------ */

/**
 * Map over items with a bounded number of concurrent async operations.
 * Results keep their input order. Errors reject the whole run.
 */
export async function mapPool(items, limit, worker) {
  const list = Array.from(items);
  const results = new Array(list.length);
  const size = Math.max(1, Math.min(Number(limit) || 1, list.length || 1));
  let cursor = 0;
  const runners = new Array(size).fill(null).map(async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= list.length) return;
      results[index] = await worker(list[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}
