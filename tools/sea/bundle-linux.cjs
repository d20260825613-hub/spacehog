// spacehog 0.2.0 (cli) — bundled from src/
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/cli.js
var import_node_fs2 = __toESM(require("node:fs"), 1);
var import_node_os = __toESM(require("node:os"), 1);
var import_node_path3 = __toESM(require("node:path"), 1);

// src/hash.js
var import_node_crypto = __toESM(require("node:crypto"), 1);
var import_node_fs = __toESM(require("node:fs"), 1);
var import_promises = __toESM(require("node:fs/promises"), 1);
var HASH_ALGORITHMS = ["md5", "sha1", "sha256"];
var DEFAULT_HEAD_BYTES = 64 * 1024;
function isSupportedAlgorithm(name) {
  return HASH_ALGORITHMS.includes(String(name).toLowerCase());
}
async function hashHead(filePath, algorithm = "md5", length = DEFAULT_HEAD_BYTES) {
  const handle = await import_promises.default.open(filePath, "r");
  try {
    const buffer = Buffer.allocUnsafe(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    const slice = bytesRead === length ? buffer : buffer.subarray(0, bytesRead);
    return { hash: digest(algorithm, slice), bytesRead, complete: bytesRead < length };
  } finally {
    await handle.close();
  }
}
function hashFile(filePath, algorithm = "md5") {
  return new Promise((resolve, reject) => {
    const hash = import_node_crypto.default.createHash(algorithm);
    const stream = import_node_fs.default.createReadStream(filePath, { highWaterMark: 1024 * 1024 });
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}
function digest(algorithm, buffer) {
  return import_node_crypto.default.createHash(algorithm).update(buffer).digest("hex");
}
var HashCache = class _HashCache {
  constructor(storePath, { enabled, entries = /* @__PURE__ */ new Map(), loaded = false } = {}) {
    this.storePath = storePath ?? null;
    this.enabled = enabled === void 0 ? Boolean(this.storePath) : Boolean(enabled);
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
    const cache = new _HashCache(storePath, { enabled });
    if (!cache.enabled || !cache.storePath) return cache;
    try {
      const raw = await import_promises.default.readFile(storePath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && parsed.version === 1 && parsed.entries && typeof parsed.entries === "object") {
        for (const [key, value] of Object.entries(parsed.entries)) {
          if (typeof value === "string") cache.entries.set(key, value);
        }
      }
    } catch {
    }
    cache.loaded = true;
    return cache;
  }
  static key(file, algorithm) {
    return `${algorithm}:${file.path}|${file.size}|${Math.floor(file.mtimeMs)}`;
  }
  get(file, algorithm) {
    if (!this.enabled) return null;
    const value = this.entries.get(_HashCache.key(file, algorithm));
    if (value) this.hits += 1;
    else this.misses += 1;
    return value ?? null;
  }
  set(file, algorithm, hash) {
    if (!this.enabled) return;
    this.entries.set(_HashCache.key(file, algorithm), hash);
    this.dirty = true;
  }
  async save({ maxEntries = 2e5 } = {}) {
    if (!this.enabled || !this.dirty) return { saved: false, entries: this.entries.size };
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
      updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      entries: Object.fromEntries(this.entries)
    });
    const tmp = `${this.storePath}.${process.pid}.tmp`;
    try {
      await import_promises.default.mkdir(storePathDir(this.storePath), { recursive: true });
      await import_promises.default.writeFile(tmp, payload, "utf8");
      await import_promises.default.rename(tmp, this.storePath);
      return { saved: true, entries: this.entries.size };
    } catch {
      await import_promises.default.rm(tmp, { force: true }).catch(() => {
      });
      return { saved: false, entries: this.entries.size };
    }
  }
};
function storePathDir(storePath) {
  const idx = Math.max(storePath.lastIndexOf("/"), storePath.lastIndexOf("\\"));
  return idx > 0 ? storePath.slice(0, idx) : ".";
}
async function mapPool(items, limit, worker) {
  const list = Array.from(items);
  const results = new Array(list.length);
  const size = Math.max(1, Math.min(Number(limit) || 1, list.length || 1));
  let cursor = 0;
  const runners = new Array(size).fill(null).map(async () => {
    for (; ; ) {
      const index = cursor;
      cursor += 1;
      if (index >= list.length) return;
      results[index] = await worker(list[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

// src/util.js
var VERSION = "0.2.0";
var BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];
function formatBytes(bytes, { space = true } = {}) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return "0 B";
  if (n === 0) return `0${space ? " " : ""}B`;
  const exp = Math.min(Math.floor(Math.log(n) / Math.log(1024)), BYTE_UNITS.length - 1);
  const value = n / 1024 ** exp;
  const rounded = value >= 100 || exp === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded}${space ? " " : ""}${BYTE_UNITS[exp]}`;
}
function parseSize(input) {
  if (typeof input === "number") return Number.isFinite(input) && input >= 0 ? Math.floor(input) : null;
  if (typeof input !== "string") return null;
  const m = /^\s*(\d+(?:\.\d+)?)\s*([a-zA-Z]*)\s*$/.exec(input);
  if (!m) return null;
  const value = Number(m[1]);
  const unit = m[2].toLowerCase();
  if (!Number.isFinite(value)) return null;
  if (unit === "" || unit === "b" || unit === "byte" || unit === "bytes") return Math.floor(value);
  const index = BYTE_UNITS.findIndex((u) => u.toLowerCase() === unit || `${u.toLowerCase()}b` === unit);
  if (index <= 0) return null;
  return Math.floor(value * 1024 ** index);
}
function toPosix(p) {
  return String(p).split("\\").join("/");
}
function sum(values) {
  let total = 0;
  for (const v of values) total += v;
  return total;
}
function ellipsize(text, max) {
  const s = String(text);
  if (!Number.isFinite(max) || max < 4 || s.length <= max) return s;
  const keep = max - 1;
  const head = Math.ceil(keep / 2);
  const tail = keep - head;
  return `${s.slice(0, head)}\u2026${s.slice(s.length - tail)}`;
}
function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "0ms";
  if (ms < 1e3) return `${Math.round(ms)}ms`;
  const seconds = ms / 1e3;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 2 : 1)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m${String(s).padStart(2, "0")}s`;
}
function isoNow(date = /* @__PURE__ */ new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}
function formatAge(mtimeMs, now = Date.now()) {
  if (!Number.isFinite(mtimeMs) || mtimeMs <= 0) return "unknown";
  const diff = Math.max(0, now - mtimeMs);
  const day = 864e5;
  const days = Math.floor(diff / day);
  if (days === 0) {
    const hours = Math.floor(diff / 36e5);
    if (hours === 0) {
      const minutes = Math.floor(diff / 6e4);
      return minutes <= 0 ? "just now" : `${minutes}m ago`;
    }
    return `${hours}h ago`;
  }
  if (days < 31) return `${days}d ago`;
  const months = Math.floor(days / 30.44);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(days / 365.25)}y ago`;
}

// src/keep.js
function depthOf(file) {
  const path4 = toPosix(file.display ?? file.path ?? "");
  return path4.split("/").filter(Boolean).length;
}
function parentName(file) {
  const path4 = toPosix(file.path ?? file.display ?? "");
  const parts = path4.split("/").filter(Boolean);
  return (parts.length >= 2 ? parts[parts.length - 2] : "").toLowerCase();
}
var POLICIES = {
  /**
   * Keep the most recently modified copy: the one you worked on last is
   * usually the live one, and the older copies are the stale ones.
   */
  newest: (file) => -mtime(file),
  /** Keep the least recently modified copy — the original of a set of copies. */
  oldest: (file) => mtime(file),
  /** Keep the copy with the shallowest path, then the shortest path. */
  "shortest-path": (file) => depthOf(file) * 1e3 + String(file.display ?? file.path ?? "").length,
  /** Keep the first copy in report order (deterministic: path-sorted upstream). */
  first: () => 0
};
function mtime(file) {
  const value = Number(file.mtimeMs);
  return Number.isFinite(value) ? value : 0;
}
var KEEP_POLICIES = Object.keys(POLICIES);
function rankKeep(files, policy = "newest", options = {}) {
  const score = POLICIES[policy] ?? POLICIES.newest;
  const prefer = options.prefer ? String(options.prefer).toLowerCase() : null;
  let bestIndex = 0;
  let bestScore = Infinity;
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const preference = prefer && parentName(file) === prefer ? -1e12 : 0;
    const value = preference + score(file, index);
    if (value < bestScore) {
      bestScore = value;
      bestIndex = index;
    }
  }
  return bestIndex;
}
function suggestKeep(files, policy = "newest", options = {}) {
  const list = Array.isArray(files) ? files : [];
  if (list.length === 0) {
    return { keep: null, redundant: [], policy, prefer: options.prefer ?? null };
  }
  const index = rankKeep(list, policy, options);
  return {
    keep: list[index],
    redundant: list.filter((_, i) => i !== index),
    policy,
    prefer: options.prefer ? String(options.prefer).toLowerCase() : null
  };
}
function explainKeep(policy, prefer = null) {
  const suffix = prefer ? `, preferring a folder named "${prefer}"` : "";
  switch (policy) {
    case "oldest":
      return `keeping the least recently modified copy (treat it as the original)${suffix}`;
    case "shortest-path":
      return `keeping the copy with the shallowest path${suffix}`;
    case "first":
      return `keeping the first copy in path order${suffix}`;
    case "newest":
    default:
      return `keeping the most recently modified copy${suffix}`;
  }
}

// src/args.js
var SPEC = {
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
  json: { type: "boolean" },
  markdown: { type: "boolean" },
  pretty: { type: "boolean" },
  duplicates: { type: "boolean", default: true, negatable: true },
  progress: { type: "boolean", default: void 0, negatable: true },
  color: { type: "boolean", default: void 0, negatable: true },
  hidden: { type: "boolean", default: true, negatable: true },
  "ignore-dirs": { type: "boolean", default: true, negatable: true },
  "follow-symlinks": { type: "boolean", default: false, negatable: true },
  "no-cache": { type: "boolean", default: false },
  top: { type: "number", short: "n", default: 15, min: 0 },
  "min-size": { type: "size", short: "s", default: 0 },
  "max-size": { type: "size", short: "m", default: null },
  "max-depth": { type: "number", default: null, min: 0 },
  "max-entries": { type: "number", default: null, min: 1 },
  concurrency: { type: "number", short: "c", default: 8, min: 1 },
  hash: { type: "string", short: "a", default: "md5", choices: HASH_ALGORITHMS },
  keep: { type: "string", short: "k", default: "newest", choices: KEEP_POLICIES },
  "keep-prefer": { type: "string", default: null },
  "fail-on-dupes": { type: "size", default: null },
  exclude: { type: "string", repeat: true, default: [] },
  cache: { type: "string", default: null }
};
var ALIASES = /* @__PURE__ */ new Map();
for (const [name, def] of Object.entries(SPEC)) {
  if (def.short) ALIASES.set(def.short, name);
}
var USAGE = `spacehog \u2014 find out what is eating your disk

Usage
  spacehog [path] [options]

Sections
  duplicates   groups of byte-identical files, and what deleting extras saves
  large files  the biggest files in the tree
  junk         regenerable leftovers (.tmp, .bak, .log, build artifacts ...)
  sparse       files whose real disk usage is far below their logical size
  empty dirs   folders with no files anywhere inside

Options
  -n, --top <n>            entries listed per section (default 15)
  -s, --min-size <size>    ignore files smaller than size, e.g. 1mb (default 0)
  -m, --max-size <size>    never fully hash files larger than size (default: all)
  -a, --hash <algo>        md5 | sha1 | sha256 (default md5)
  -k, --keep <policy>      which copy of a duplicate to keep:
                             newest (default), oldest, shortest-path, first
      --keep-prefer <name> give copies inside a folder with this name priority
  -c, --concurrency <n>    parallel file reads for hashing (default 8)
      --max-depth <n>      limit directory recursion depth
      --max-entries <n>    stop collecting after n files
      --exclude <glob>     skip matching paths (repeatable), e.g. --exclude "*/backup/*"
      --no-duplicates      skip duplicate detection entirely
      --no-ignore-dirs     also scan node_modules, .git, dist, ... (on by default)
      --no-hidden          ignore dot-files and dot-directories
      --follow-symlinks    follow symlinked directories (may loop)
      --no-cache           do not read/write the hash cache
      --cache <file>       override the hash cache location
      --json               machine-readable report
      --markdown           Markdown report (good for issues and PRs)
      --pretty             indent JSON output
      --progress           force the progress line; --no-progress silences it
      --fail-on-dupes <size>  exit 2 when duplicate waste reaches size (for CI)
      --color / --no-color    force or disable ANSI colors
  -h, --help               show this help
  -v, --version            print the version

Examples
  spacehog                       audit the current directory
  spacehog ~/Downloads -n 20     biggest files and dupes in Downloads
  spacehog C:\\Users -s 10mb       only look at files of 10 MB and up
  spacehog . --keep oldest       keep the original, delete the later copies
  spacehog . --json > report.json
  spacehog . --fail-on-dupes 500mb      fail CI when 500 MB is duplicated

Exit codes
  0  report produced
  1  invalid arguments or scan failure
  2  --fail-on-dupes threshold reached
`;
function fail(message) {
  return { ok: false, message };
}
function charFor(name) {
  return SPEC[name]?.short ?? name;
}
function parseArgs(argv) {
  const values = {};
  for (const [name, def] of Object.entries(SPEC)) {
    if (def.default !== void 0) values[name] = def.repeat ? [...def.default] : def.default;
  }
  const paths = [];
  const args = [...argv];
  let onlyPositional = false;
  while (args.length > 0) {
    const token = args.shift();
    if (onlyPositional || token === "-" || !token.startsWith("-")) {
      paths.push(token);
      continue;
    }
    if (token === "--") {
      onlyPositional = true;
      continue;
    }
    let name = null;
    let inline = null;
    let inlineProvided = false;
    if (token.startsWith("--")) {
      let body = token.slice(2);
      const eq = body.indexOf("=");
      if (eq >= 0) {
        inline = body.slice(eq + 1);
        inlineProvided = true;
        body = body.slice(0, eq);
      }
      if (body.startsWith("no-") && SPEC[body.slice(3)]?.negatable) {
        values[body.slice(3)] = false;
        continue;
      }
      name = body;
      if (!SPEC[name]) return fail(`unknown option: --${name}`);
    } else {
      const chars = [...token.slice(1)];
      let pendingValue = null;
      for (let i = 0; i < chars.length; i += 1) {
        const mapped = ALIASES.get(chars[i]);
        if (!mapped) return fail(`unknown option: -${chars[i]}`);
        const def2 = SPEC[mapped];
        const rest = chars.slice(i + 1).join("");
        if (def2.type === "boolean") {
          values[mapped] = true;
          continue;
        }
        if (rest.length > 0) {
          name = mapped;
          inline = rest.replace(/^=/, "");
          inlineProvided = true;
        } else {
          pendingValue = mapped;
        }
        break;
      }
      if (pendingValue !== null) {
        if (args.length === 0) return fail(`option -${charFor(pendingValue)} (--${pendingValue}) requires a value`);
        name = pendingValue;
        inline = args.shift();
        inlineProvided = true;
      }
      if (name === null && pendingValue === null) continue;
    }
    const def = SPEC[name];
    if (def.type === "boolean") {
      if (inlineProvided) {
        if (!/^(true|false|1|0)$/i.test(inline)) return fail(`--${name} takes no value`);
        values[name] = /^(true|1)$/i.test(inline);
      } else {
        values[name] = true;
      }
      continue;
    }
    if (!inlineProvided) {
      if (args.length === 0) return fail(`option --${name} requires a value`);
      inline = args.shift();
    }
    if (def.repeat) {
      values[name].push(String(inline));
      continue;
    }
    const result = applyValue(values, name, def, inline);
    if (result && result.ok === false) return result;
  }
  if (paths.length === 0) paths.push(".");
  if (!isSupportedAlgorithm(values.hash)) {
    return fail(`unsupported hash algorithm: ${values.hash} (expected ${HASH_ALGORITHMS.join(", ")})`);
  }
  return { ok: true, values, paths };
}
function applyValue(values, name, def, raw) {
  switch (def.type) {
    case "string": {
      const value = String(raw);
      if (def.choices && !def.choices.includes(value.toLowerCase())) {
        return fail(`--${name} must be one of: ${def.choices.join(", ")}`);
      }
      values[name] = def.choices ? value.toLowerCase() : value;
      return null;
    }
    case "number": {
      const value = Number(raw);
      if (!Number.isFinite(value)) return fail(`--${name} expects a number, got "${raw}"`);
      if (def.min !== void 0 && value < def.min) return fail(`--${name} must be >= ${def.min}`);
      values[name] = Math.floor(value);
      return null;
    }
    case "size": {
      const value = parseSize(raw);
      if (value === null) return fail(`--${name} expects a size such as 10mb, got "${raw}"`);
      values[name] = value;
      return null;
    }
    default:
      values[name] = raw;
      return null;
  }
}
function globToRegExp(pattern) {
  const source = String(pattern).split("\\").join("/");
  const normalized = source.includes("/") ? source : `**/${source}`;
  let out = "";
  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];
    if (char === "*") {
      if (normalized[i + 1] === "*") {
        if (normalized[i + 2] === "/") {
          out += "(?:.*/)?";
          i += 2;
        } else {
          out += ".*";
          i += 1;
        }
      } else {
        out += "[^/]*";
      }
      continue;
    }
    if (char === "?") {
      out += "[^/]";
      continue;
    }
    if (char === "{") {
      const end = normalized.indexOf("}", i);
      if (end > i) {
        const options = normalized.slice(i + 1, end).split(",").map((option) => option.replace(/[.+^${}()|[\]\\]/g, "\\$&"));
        out += `(?:${options.join("|")})`;
        i = end;
        continue;
      }
    }
    out += char.replace(/[.+^${}()|[\]\\]/, "\\$&");
  }
  return new RegExp(`^${out}$`, process.platform === "win32" ? "i" : "");
}
function buildExcludeFilter(patterns) {
  if (!patterns || patterns.length === 0) return () => false;
  const regexes = patterns.map(globToRegExp);
  return (posixPath) => regexes.some((re) => re.test(posixPath));
}

// src/detectors.js
var import_node_path = __toESM(require("node:path"), 1);
async function findDuplicates(files, options = {}) {
  const {
    algorithm = "md5",
    cache = null,
    concurrency = 8,
    headBytes = DEFAULT_HEAD_BYTES,
    maxFileSize = Infinity,
    root = "",
    keepPolicy = "newest",
    keepPrefer = null,
    onProgress = null,
    signal = null
  } = options;
  const checked = { headHashes: 0, fullHashes: 0, inodes: 0, bytesHashed: 0 };
  const bySize = /* @__PURE__ */ new Map();
  for (const file of files) {
    if (signal?.aborted) break;
    if (!file || !Number.isFinite(file.size)) continue;
    const bucket = bySize.get(file.size);
    if (bucket) bucket.push(file);
    else bySize.set(file.size, [file]);
  }
  const inoUsable = files.some((file) => file && typeof file.ino === "number" && file.ino !== 0);
  const candidates = [];
  const hardlinkGroups = [];
  let hardlinkWastedBytes = 0;
  for (const [size, bucket] of bySize) {
    if (bucket.length < 2) continue;
    if (size > maxFileSize) continue;
    if (size === 0) {
      candidates.push({ size, files: [...bucket], hash: "empty", hashComplete: true });
      continue;
    }
    const byInode = /* @__PURE__ */ new Map();
    if (inoUsable) {
      for (const file of bucket) {
        if (file.ino == null || file.dev == null || file.ino === 0) continue;
        const key = `${file.dev}:${file.ino}`;
        const group = byInode.get(key);
        if (group) group.push(file);
        else byInode.set(key, [file]);
      }
    }
    const distinct = [];
    const seenInodes = /* @__PURE__ */ new Set();
    for (const file of bucket) {
      if (!inoUsable || file.ino == null || file.dev == null || file.ino === 0) {
        distinct.push(file);
        continue;
      }
      const key = `${file.dev}:${file.ino}`;
      if (seenInodes.has(key)) continue;
      seenInodes.add(key);
      distinct.push(file);
    }
    for (const group of byInode.values()) {
      if (group.length > 1) {
        checked.inodes += group.length;
        hardlinkWastedBytes += size * (group.length - 1);
        hardlinkGroups.push({
          size,
          savedBytes: size * (group.length - 1),
          files: group.map((file) => describeFile(file, root))
        });
      }
    }
    if (distinct.length > 1) candidates.push({ size, files: distinct, hash: null });
  }
  const toFullHash = [];
  for (const candidate of candidates) {
    if (signal?.aborted) break;
    if (candidate.hash !== null) {
      toFullHash.push(candidate);
      continue;
    }
    const { size, files: group } = candidate;
    const heads = await mapPool(group, concurrency, async (file) => {
      const cached = cache?.get(file, `${algorithm}:head`);
      if (cached) return cached;
      try {
        const { hash } = await hashHead(file.path, algorithm, headBytes);
        cache?.set(file, `${algorithm}:head`, hash);
        return hash;
      } catch {
        return null;
      }
    });
    const buckets = /* @__PURE__ */ new Map();
    group.forEach((file, index) => {
      const head = heads[index];
      if (head == null) return;
      checked.headHashes += 1;
      checked.bytesHashed += Math.min(size, headBytes);
      const key = size < headBytes ? `full:${head}` : head;
      const bucket = buckets.get(key);
      if (bucket) bucket.push(file);
      else buckets.set(key, [file]);
    });
    for (const [key, bucket] of buckets) {
      if (bucket.length < 2) continue;
      if (key.startsWith("full:")) {
        toFullHash.push({ size, files: bucket, hash: key.slice(5), hashComplete: true });
      } else {
        toFullHash.push({ size, files: bucket, hash: null });
      }
    }
    onProgress?.({ phase: "head", checked });
  }
  const groups = [];
  let wastedBytes = 0;
  let duplicateFiles = 0;
  for (const candidate of toFullHash) {
    if (signal?.aborted) break;
    const { size, files: group } = candidate;
    let hashes;
    if (candidate.hashComplete) {
      hashes = group.map(() => candidate.hash);
    } else {
      hashes = await mapPool(group, concurrency, async (file) => {
        const cached = cache?.get(file, algorithm);
        if (cached) return cached;
        try {
          const hash = await hashFile(file.path, algorithm);
          cache?.set(file, algorithm, hash);
          checked.fullHashes += 1;
          checked.bytesHashed += size;
          return hash;
        } catch {
          return null;
        }
      });
    }
    const buckets = /* @__PURE__ */ new Map();
    group.forEach((file, index) => {
      const hash = hashes[index];
      if (hash == null) return;
      const bucket = buckets.get(hash);
      if (bucket) bucket.push(file);
      else buckets.set(hash, [file]);
    });
    for (const [hash, bucket] of buckets) {
      if (bucket.length < 2) continue;
      const saved = size * (bucket.length - 1);
      wastedBytes += saved;
      duplicateFiles += bucket.length;
      const files2 = bucket.slice().sort((a, b) => a.mtimeMs - b.mtimeMs).map((file) => describeFile(file, root));
      const suggestion = suggestKeep(files2, keepPolicy, { prefer: keepPrefer });
      groups.push({
        hash,
        algorithm,
        size,
        copies: bucket.length,
        wastedBytes: saved,
        files: files2,
        keep: suggestion.keep ? { path: suggestion.keep.path, display: suggestion.keep.display } : null,
        redundant: suggestion.redundant.map((file) => ({ path: file.path, display: file.display })),
        keepPolicy: suggestion.policy,
        keepPrefer: suggestion.prefer
      });
    }
    onProgress?.({ phase: "full", checked });
  }
  groups.sort((a, b) => b.wastedBytes - a.wastedBytes);
  hardlinkGroups.sort((a, b) => b.savedBytes - a.savedBytes);
  return {
    groups,
    hardlinkGroups,
    hardlinkWastedBytes,
    stats: {
      ...checked,
      duplicateFiles,
      duplicateGroups: groups.length,
      wastedBytes,
      algorithm
    }
  };
}
function describeFile(file, root = "") {
  return {
    path: toPosix(file.path),
    display: file.display ?? (root ? relativeTo(file.path, root) : toPosix(file.path)),
    size: file.size,
    mtimeMs: file.mtimeMs,
    mtime: file.mtimeMs ? new Date(file.mtimeMs).toISOString() : null,
    sparse: isSparse(file)
  };
}
function relativeTo(filePath, root) {
  const posix = toPosix(filePath);
  const base = toPosix(root).replace(/\/+$/, "");
  if (base && posix.startsWith(`${base}/`)) return posix.slice(base.length + 1);
  return posix;
}
function findLargeFiles(files, limit = 15, root = "") {
  return files.slice().sort((a, b) => b.size - a.size || (a.display < b.display ? -1 : 1)).slice(0, Math.max(0, limit)).map((file) => ({ ...describeFile(file, root), sparse: isSparse(file) }));
}
function isSparse(file, { minGap = 4 * 1024 * 1024, ratio = 0.5 } = {}) {
  if (!file || file.blocks == null || !Number.isFinite(file.blocks)) return false;
  const allocated = file.blocks * 512;
  const gap = file.size - allocated;
  if (gap < minGap) return false;
  return allocated < file.size * ratio;
}
function findSparseFiles(files, limit = 10, root = "") {
  return files.filter((file) => isSparse(file)).sort((a, b) => b.size - b.blocks * 512 - (a.size - a.blocks * 512)).slice(0, Math.max(0, limit)).map((file) => ({
    ...describeFile(file, root),
    allocatedBytes: file.blocks * 512,
    savedBytes: file.size - file.blocks * 512
  }));
}
var DEFAULT_JUNK_EXTENSIONS = [
  ".tmp",
  ".temp",
  ".bak",
  ".old",
  ".orig",
  ".rej",
  ".log",
  ".dmp",
  ".crdownload",
  ".part",
  ".partial",
  ".download",
  ".swp",
  ".swo",
  ".pyc",
  ".pyo",
  ".class",
  ".o",
  ".obj",
  ".tsbuildinfo",
  ".DS_Store",
  ".thumbs.db"
];
var DEFAULT_JUNK_NAMES = [".ds_store", "thumbs.db", "desktop.ini", "npm-debug.log"];
function isJunkFile(file, { extensions = DEFAULT_JUNK_EXTENSIONS, names = DEFAULT_JUNK_NAMES } = {}) {
  const base = import_node_path.default.basename(file.path ?? file.display ?? "").toLowerCase();
  if (names.includes(base)) return true;
  return extensions.some((ext) => base.endsWith(ext));
}
function findJunkFiles(files, limit = 15, options = {}) {
  const { root = "", ...matchOptions } = options;
  const matched = files.filter((file) => isJunkFile(file, matchOptions));
  const totalBytes = matched.reduce((acc, file) => acc + file.size, 0);
  const top = matched.slice().sort((a, b) => b.size - a.size || (a.display < b.display ? -1 : 1)).slice(0, Math.max(0, limit)).map((file) => describeFile(file, root));
  return { files: top, count: matched.length, totalBytes };
}
function findEmptyDirs(directories, { keep = /* @__PURE__ */ new Set() } = {}) {
  const parentOf = /* @__PURE__ */ new Map();
  const known = /* @__PURE__ */ new Set();
  for (const dir of directories) known.add(dir.path);
  for (const dir of directories) {
    const parent = import_node_path.default.dirname(dir.path);
    parentOf.set(dir.path, parent === dir.path ? null : parent);
  }
  const notEmpty = new Set(keep);
  const ordered = directories.slice().sort((a, b) => b.depth - a.depth);
  for (const dir of ordered) {
    if (notEmpty.has(dir.path)) {
      const parent = parentOf.get(dir.path);
      if (parent && known.has(parent)) notEmpty.add(parent);
      continue;
    }
    if (dir.fileCount > 0) {
      notEmpty.add(dir.path);
      const parent = parentOf.get(dir.path);
      if (parent && known.has(parent)) notEmpty.add(parent);
    }
  }
  const empty = directories.filter((dir) => !notEmpty.has(dir.path));
  return {
    dirs: empty.slice().sort((a, b) => b.depth - a.depth || (a.display < b.display ? -1 : 1)).map((dir) => ({ path: toPosix(dir.path), display: dir.display, depth: dir.depth })),
    count: empty.length
  };
}

// src/walker.js
var import_promises2 = __toESM(require("node:fs/promises"), 1);
var import_node_path2 = __toESM(require("node:path"), 1);
var DEFAULT_IGNORED_DIRS = [
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  ".cache",
  ".next",
  ".nuxt",
  ".venv",
  "venv",
  "__pycache__",
  ".mypy_cache",
  ".pytest_cache",
  ".tox",
  ".gradle",
  ".terraform",
  "target",
  "dist",
  "build",
  ".DS_Store"
];
var ERRORS_KEPT = 40;
async function walk(root, options = {}) {
  const {
    ignoreDirs = [],
    includeHidden = true,
    maxDepth = Infinity,
    maxEntries = Infinity,
    followSymlinks = false,
    onProgress,
    signal
  } = options;
  const ignored = new Set(ignoreDirs);
  const files = [];
  const directories = [];
  const errors = [];
  let totalBytes = 0;
  let fileCount = 0;
  let dirCount = 0;
  let skippedDirCount = 0;
  let symlinkCount = 0;
  let symlinkedDirCount = 0;
  let truncated = false;
  const recordError = (errorPath, err) => {
    if (errors.length < ERRORS_KEPT) {
      errors.push({ path: errorPath, code: err?.code ?? "EUNKNOWN", message: err?.message ?? String(err) });
    }
  };
  const start = import_node_path2.default.resolve(root);
  let rootStat;
  try {
    rootStat = await import_promises2.default.stat(start);
  } catch (err) {
    recordError(start, err);
    return {
      root: start,
      files,
      directories,
      errors,
      stats: { fileCount, dirCount, totalBytes, skippedDirCount, symlinkCount, symlinkedDirCount, truncated }
    };
  }
  if (!rootStat.isDirectory()) {
    recordError(start, Object.assign(new Error("not a directory"), { code: "ENOTDIR" }));
    return {
      root: start,
      files,
      directories,
      errors,
      stats: { fileCount, dirCount, totalBytes, skippedDirCount, symlinkCount, symlinkedDirCount, truncated }
    };
  }
  const queue = [{ dir: start, display: "", depth: 0 }];
  while (queue.length > 0) {
    if (signal?.aborted) break;
    const { dir, display, depth } = queue.shift();
    dirCount += 1;
    const directory = { path: dir, display, depth, fileCount: 0, subdirCount: 0 };
    directories.push(directory);
    let entries;
    try {
      entries = await import_promises2.default.readdir(dir, { withFileTypes: true });
    } catch (err) {
      recordError(dir, err);
      continue;
    }
    entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const entry of entries) {
      if (signal?.aborted) break;
      const name = entry.name;
      if (!includeHidden && name.startsWith(".")) continue;
      const full = import_node_path2.default.join(dir, name);
      const childDisplay = display ? `${display}/${name}` : name;
      let isDirectory = entry.isDirectory();
      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        symlinkCount += 1;
        if (!followSymlinks) continue;
        try {
          const target = await import_promises2.default.stat(full);
          isDirectory = target.isDirectory();
          isFile = target.isFile();
          if (isDirectory) symlinkedDirCount += 1;
        } catch (err) {
          recordError(full, err);
          continue;
        }
      }
      if (isDirectory) {
        if (ignored.has(name)) {
          skippedDirCount += 1;
          continue;
        }
        if (depth + 1 > maxDepth) continue;
        directory.subdirCount += 1;
        queue.push({ dir: full, display: childDisplay, depth: depth + 1 });
        continue;
      }
      if (!isFile) continue;
      if (fileCount >= maxEntries) {
        truncated = true;
        continue;
      }
      let stat;
      try {
        stat = await import_promises2.default.lstat(full);
      } catch (err) {
        recordError(full, err);
        continue;
      }
      fileCount += 1;
      totalBytes += stat.size;
      directory.fileCount += 1;
      files.push({
        path: full,
        display: childDisplay,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        blocks: stat.blocks ?? null,
        ino: stat.ino ?? null,
        dev: stat.dev ?? null,
        depth: depth + 1
      });
      onProgress?.({ files: fileCount, dirs: dirCount, bytes: totalBytes });
    }
  }
  return {
    root: start,
    files,
    directories,
    errors,
    stats: { fileCount, dirCount, totalBytes, skippedDirCount, symlinkCount, symlinkedDirCount, truncated }
  };
}

// src/audit.js
async function audit(options) {
  const {
    root,
    minSize = 0,
    top = 15,
    maxDepth = Infinity,
    includeHidden = true,
    ignoreDirs = true,
    followSymlinks = false,
    maxEntries = Infinity,
    duplicates = true,
    algorithm = "md5",
    keepPolicy = "newest",
    keepPrefer = null,
    concurrency = 8,
    maxHashSize = Infinity,
    cachePath = null,
    onProgress = null,
    signal = null
  } = options;
  const startedAt = Date.now();
  onProgress?.({ phase: "scan", stage: "walking" });
  const walked = await walk(root, {
    ignoreDirs: ignoreDirs ? DEFAULT_IGNORED_DIRS : [],
    includeHidden,
    maxDepth,
    maxEntries,
    followSymlinks,
    signal,
    onProgress: (progress) => onProgress?.({ phase: "scan", stage: "walking", ...progress })
  });
  const files = walked.files;
  const directories = walked.directories;
  const relevant = minSize > 0 ? files.filter((file) => file.size >= minSize) : files;
  const totalBytes = sum(files.map((file) => file.size));
  onProgress?.({ phase: "analyze", stage: "large" });
  const largeFiles = findLargeFiles(relevant, top, walked.root);
  const junk = findJunkFiles(relevant, top, { root: walked.root });
  const sparse = findSparseFiles(relevant, top, walked.root);
  const empty = findEmptyDirs(directories);
  let duplicateResult = {
    groups: [],
    hardlinkGroups: [],
    hardlinkWastedBytes: 0,
    stats: {
      algorithm,
      duplicateFiles: 0,
      duplicateGroups: 0,
      wastedBytes: 0,
      headHashes: 0,
      fullHashes: 0,
      bytesHashed: 0,
      inodes: 0
    }
  };
  let cacheReport = { enabled: Boolean(cachePath), hits: 0, misses: 0, saved: false, entries: 0 };
  if (duplicates) {
    const cache = await HashCache.load(cachePath, { enabled: Boolean(cachePath) });
    onProgress?.({ phase: "analyze", stage: "duplicates" });
    duplicateResult = await findDuplicates(relevant, {
      algorithm,
      cache,
      concurrency,
      maxFileSize: maxHashSize,
      root: walked.root,
      keepPolicy,
      keepPrefer,
      signal,
      onProgress: (event) => onProgress?.({ phase: "analyze", stage: "duplicates", ...event })
    });
    const saved = await cache.save();
    cacheReport = {
      enabled: cache.enabled,
      hits: cache.hits,
      misses: cache.misses,
      saved: saved.saved,
      entries: saved.entries
    };
  }
  const finishedAt = Date.now();
  return {
    tool: { name: "spacehog", version: VERSION },
    generatedAt: isoNow(new Date(finishedAt)),
    root: walked.root,
    options: {
      minSize,
      top,
      maxDepth: Number.isFinite(maxDepth) ? maxDepth : null,
      includeHidden,
      ignoreDirs,
      followSymlinks,
      duplicates,
      algorithm,
      keepPolicy,
      keepPrefer,
      maxHashSize: Number.isFinite(maxHashSize) ? maxHashSize : null
    },
    summary: {
      files: walked.stats.fileCount,
      directories: walked.stats.dirCount,
      totalBytes,
      humanTotal: formatBytes(totalBytes),
      ignoredDirectories: walked.stats.skippedDirCount,
      symlinksSkipped: followSymlinks ? 0 : walked.stats.symlinkCount,
      errorCount: walked.errors.length,
      truncated: walked.stats.truncated,
      durationMs: finishedAt - startedAt
    },
    duplicates: duplicateResult.stats,
    duplicateGroups: duplicateResult.groups,
    hardlinkGroups: duplicateResult.hardlinkGroups,
    hardlinkSavedBytes: duplicateResult.hardlinkWastedBytes,
    cacheCandidates: cacheReport,
    largeFiles,
    junk,
    sparse,
    emptyDirs: empty.dirs,
    emptyDirCount: empty.count,
    errors: walked.errors
  };
}

// src/reporter.js
var RULE_WIDTH = 72;
var PALETTE = {
  bold: [1, 22],
  dim: [2, 22],
  red: [31, 39],
  green: [32, 39],
  yellow: [33, 39],
  blue: [34, 39],
  magenta: [35, 39],
  cyan: [36, 39],
  gray: [90, 39]
};
function createColors(enabled) {
  if (!enabled) {
    const identity = (text) => String(text);
    return new Proxy(identity, {
      get: () => identity,
      apply: (_t, _s, args) => String(args[0])
    });
  }
  return new Proxy((text, ...styles) => applyStyles(text, styles), {
    get: (_target, prop) => (text, ...styles) => applyStyles(text, [prop, ...styles]),
    apply: (_target, _this, args) => applyStyles(args[0], args.slice(1))
  });
}
function applyStyles(text, styles) {
  let codes = "";
  for (const style of styles.flat()) {
    const code = PALETTE[style];
    if (code) codes += `\x1B[${code[0]}m`;
  }
  if (!codes) return String(text);
  return `${codes}${text}\x1B[0m`;
}
function shouldUseColor({ flag, stream = process.stdout, env = process.env } = {}) {
  if (flag === true) return true;
  if (flag === false) return false;
  if (env.NO_COLOR !== void 0 && env.NO_COLOR !== "") return false;
  if (env.FORCE_COLOR !== void 0 && env.FORCE_COLOR !== "" && env.FORCE_COLOR !== "0") return true;
  if (env.TERM === "dumb") return false;
  return Boolean(stream.isTTY);
}
var SEVERITY = {
  high: (c) => c.red("HIGH"),
  medium: (c) => c.yellow("MEDIUM"),
  low: (c) => c.cyan("LOW"),
  info: (c) => c.gray("INFO")
};
function summarize(report, now = Date.now()) {
  const duplicates = report.duplicates ?? {};
  const wasted = duplicates.wastedBytes ?? 0;
  const junk = report.junk?.totalBytes ?? 0;
  const hardlinkSaved = report.hardlinkSavedBytes ?? 0;
  const sparseSaved = (report.sparse ?? []).reduce((acc, file) => acc + (file.savedBytes ?? 0), 0);
  const total = report.summary.totalBytes || 0;
  const reclaimable = wasted + junk;
  let severity = "info";
  let headline = "This tree looks tidy \u2014 nothing obvious to reclaim.";
  const share = total > 0 ? reclaimable / total : 0;
  if (reclaimable > 0) {
    if (reclaimable >= 1024 ** 3 || share >= 0.1) {
      severity = "high";
      headline = `About ${formatBytes(reclaimable)} looks reclaimable (${pct(share)} of the tree).`;
    } else if (reclaimable >= 100 * 1024 ** 2) {
      severity = "medium";
      headline = `${formatBytes(reclaimable)} of duplicates and junk found.`;
    } else {
      severity = "low";
      headline = `A modest ${formatBytes(reclaimable)} can be reclaimed.`;
    }
  }
  return {
    total,
    reclaimable,
    wasted,
    junk,
    hardlinkSaved,
    sparseSaved,
    share,
    severity,
    headline,
    now
  };
}
function pct(value) {
  if (!Number.isFinite(value) || value <= 0) return "0%";
  const p = value * 100;
  return `${p < 1 ? p.toFixed(1) : Math.round(p)}%`;
}
function renderText(report, { color = false, width = 100, now = Date.now() } = {}) {
  const c = createColors(color);
  const s = summarize(report, now);
  const out = [];
  const rule = (title = "") => {
    const label = title ? ` ${title} ` : "";
    const side = Math.max(0, RULE_WIDTH - label.length);
    const left = Math.floor(side / 2);
    out.push(c.gray("\u2500".repeat(left) + label + "\u2500".repeat(side - left)));
  };
  out.push("");
  out.push(`${c.bold("spacehog")} ${c.gray(`v${report.tool.version}`)} ${c.dim("\xB7")} ${c.dim(report.root)}`);
  rule();
  out.push(
    [
      `${c.bold(formatBytes(s.total))} scanned`,
      c.dim("\xB7"),
      `${report.summary.files} files`,
      c.dim("\xB7"),
      `${report.summary.directories} dirs`,
      c.dim("\xB7"),
      formatDuration(report.summary.durationMs)
    ].join(" ")
  );
  out.push(`${SEVERITY[s.severity](c)}  ${s.headline}`);
  out.push("");
  if (report.summary.errorCount > 0) {
    out.push(c.yellow(`! ${report.summary.errorCount} path(s) could not be read \u2014 run with --json for details`));
    out.push("");
  }
  if (report.summary.truncated) {
    out.push(c.yellow("! file limit reached (--max-entries); the report is partial"));
    out.push("");
  }
  renderDuplicates(out, report, c, now);
  renderLargeFiles(out, report, c, now);
  renderJunk(out, report, c);
  renderSparse(out, report, c, now);
  renderEmptyDirs(out, report, c, width);
  rule("next steps");
  out.push(c.dim("  Review before deleting: spacehog only reports, it never removes files."));
  if (s.wasted > 0) {
    out.push(c.dim(`  Machine-readable copies: ${c.cyan("spacehog . --json")} \u2192 duplicateGroups[].files[]`));
  }
  if (report.cacheCandidates?.enabled) {
    const cache = report.cacheCandidates;
    out.push(
      c.dim(`  Hash cache: ${cache.hits} hit(s), ${cache.misses} miss(es)${cache.saved ? ", saved" : ""}`)
    );
  }
  out.push("");
  return out.join("\n");
}
function renderDuplicates(out, report, c, now) {
  const stats = report.duplicates ?? {};
  const groups = report.duplicateGroups ?? [];
  const title = `duplicates \xB7 ${formatBytes(stats.wastedBytes ?? 0)} reclaimable`;
  out.push(`${c.bold("\u258C duplicates")} ${c.dim(`\xB7 ${groups.length} group(s) \xB7 ${stats.duplicateFiles ?? 0} file(s)`)}`);
  if (groups.length === 0) {
    out.push(c.green("  \u2713 no duplicate content found"));
    out.push("");
    return;
  }
  out.push(c.dim(`  ${title}`));
  out.push(c.dim(`  paths below are relative to ${toPosix(report.root)}`));
  if (groups.some((group) => group.keep)) {
    out.push(
      c.dim(
        `  ${c.green("keep")} marks the copy to keep \u2014 ${explainKeep(
          report.options?.keepPolicy ?? groups[0].keepPolicy ?? "newest",
          report.options?.keepPrefer ?? null
        )}`
      )
    );
  }
  groups.forEach((group, index) => {
    const marker = index === 0 ? c.red("\u25CF") : c.gray("\u25CB");
    out.push(
      `  ${marker} ${c.bold(formatBytes(group.size))} \xD7 ${group.copies} ${c.gray(`\u2192 save ${formatBytes(group.wastedBytes)}`)}`
    );
    out.push(c.dim(`     ${group.algorithm}:${String(group.hash).slice(0, 12)}`));
    const keeperPath = group.keep?.path ?? null;
    for (const file of group.files) {
      const isKeeper = keeperPath !== null && file.path === keeperPath;
      const tag = isKeeper ? ` ${c.green("\u2190 keep")}` : "";
      out.push(
        `     ${isKeeper ? c.green("\xB7") : c.dim("\xB7")} ${file.display ?? toPosix(file.path)}${tag} ${c.gray(
          `(${formatAge(file.mtimeMs, now)})`
        )}`
      );
    }
    if (keeperPath === null && group.files.length > 1) {
      out.push(c.dim("     (no keep suggestion for this group)"));
    }
  });
  if ((report.hardlinkSavedBytes ?? 0) > 0) {
    out.push(
      c.dim(
        `  note: ${formatBytes(report.hardlinkSavedBytes)} more is shared through hard links \u2014 those bytes are stored only once.`
      )
    );
  }
  out.push("");
}
function renderLargeFiles(out, report, c, now) {
  const files = report.largeFiles ?? [];
  out.push(`${c.bold("\u258C largest files")} ${c.dim(`\xB7 top ${files.length}`)}`);
  if (files.length === 0) {
    out.push(c.dim("  (none)"));
    out.push("");
    return;
  }
  const width = Math.max(...files.map((file) => String(file.display).length), 10);
  const column = Math.min(width, 64);
  files.forEach((file, index) => {
    const size = formatBytes(file.size).padStart(9);
    const rank = String(index + 1).padStart(2);
    const label = ellipsize(file.display, column).padEnd(column);
    out.push(
      `  ${c.gray(rank)} ${c.bold(size)}  ${label} ${c.gray(`${formatAge(file.mtimeMs, now)}${file.sparse ? " \xB7 sparse" : ""}`)}`
    );
  });
  out.push("");
}
function renderJunk(out, report, c) {
  const junk = report.junk ?? { files: [], count: 0, totalBytes: 0 };
  out.push(`${c.bold("\u258C junk")} ${c.dim(`\xB7 ${junk.count} file(s) \xB7 ${formatBytes(junk.totalBytes)}`)}`);
  if (junk.count === 0) {
    out.push(c.green("  \u2713 no obvious junk files"));
    out.push("");
    return;
  }
  for (const file of junk.files) {
    out.push(`  ${c.yellow("\xB7")} ${formatBytes(file.size).padStart(9)}  ${ellipsize(file.display ?? toPosix(file.path), 80)}`);
  }
  if (junk.count > junk.files.length) {
    out.push(c.dim(`  \u2026 and ${junk.count - junk.files.length} more (raise --top to see them)`));
  }
  out.push(c.dim("  Junk is regenerable by definition, but check the list: .log and .bak can matter."));
  out.push("");
}
function renderSparse(out, report, c, now) {
  const sparse = report.sparse ?? [];
  if (sparse.length === 0) return;
  out.push(`${c.bold("\u258C sparse files")} ${c.dim("\xB7 allocated far less than their logical size")}`);
  for (const file of sparse) {
    out.push(
      `  ${c.magenta("\xB7")} ${formatBytes(file.size).padStart(9)} ${c.gray(`(real: ${formatBytes(file.allocatedBytes)})`)}  ${ellipsize(file.display ?? toPosix(file.path), 70)}`
    );
  }
  out.push(c.dim(`  ${formatAge(sparse[0].mtimeMs, now)} \xB7 these are not free space to reclaim, just context.`));
  out.push("");
}
function renderEmptyDirs(out, report, c, width) {
  const dirs = report.emptyDirs ?? [];
  out.push(`${c.bold("\u258C empty directories")} ${c.dim(`\xB7 ${report.emptyDirCount ?? dirs.length}`)}`);
  if (dirs.length === 0) {
    out.push(c.green("  \u2713 none"));
    out.push("");
    return;
  }
  for (const dir of dirs.slice(0, 15)) {
    out.push(`  ${c.blue("\xB7")} ${ellipsize(dir.display, Math.max(20, width - 8))}`);
  }
  if (dirs.length > 15) out.push(c.dim(`  \u2026 and ${dirs.length - 15} more`));
  out.push("");
}
function renderMarkdown(report, { now = Date.now() } = {}) {
  const s = summarize(report, now);
  const out = [];
  const esc = (text) => String(text).replace(/\|/g, "\\|");
  const shown = (file) => esc(file.display ?? toPosix(file.path));
  out.push(`# spacehog report`);
  out.push("");
  out.push(`- **Root:** \`${toPosix(report.root)}\``);
  out.push(`- **Generated:** ${report.generatedAt}`);
  out.push(`- **Scanned:** ${formatBytes(s.total)} across ${report.summary.files} files in ${report.summary.directories} directories (${formatDuration(report.summary.durationMs)})`);
  out.push(`- **Reclaimable:** ${formatBytes(s.reclaimable)} \u2014 duplicates ${formatBytes(s.wasted)}, junk ${formatBytes(s.junk)}`);
  out.push("");
  out.push(`> ${s.headline}`);
  out.push("");
  if (s.wasted > 0) {
    out.push("## Duplicates");
    out.push("");
    out.push("| Size | Copies | Reclaimable | Sample path |");
    out.push("| ---: | ---: | ---: | --- |");
    for (const group of report.duplicateGroups.slice(0, 25)) {
      out.push(
        `| ${formatBytes(group.size)} | ${group.copies} | ${formatBytes(group.wastedBytes)} | \`${ellipsize(shown(group.files[0]), 80)}\` |`
      );
    }
    out.push("");
    for (const [index, group] of report.duplicateGroups.slice(0, 10).entries()) {
      out.push(`<details><summary>Group ${index + 1} \u2014 ${formatBytes(group.size)} \xD7 ${group.copies}</summary>`);
      out.push("");
      const keeperPath = group.keep?.path ?? null;
      for (const file of group.files) {
        const isKeeper = keeperPath !== null && file.path === keeperPath;
        out.push(`- \`${shown(file)}\`${isKeeper ? " \u2190 **keep this one**" : ""}`);
      }
      out.push("");
      out.push("</details>");
      out.push("");
    }
  }
  if (report.largeFiles.length > 0) {
    out.push("## Largest files");
    out.push("");
    out.push("| Size | File | Modified |");
    out.push("| ---: | --- | --- |");
    for (const file of report.largeFiles) {
      out.push(`| ${formatBytes(file.size)} | \`${shown(file)}\` | ${formatAge(file.mtimeMs, now)} |`);
    }
    out.push("");
  }
  if (report.junk.count > 0) {
    out.push(`## Junk (${report.junk.count} files, ${formatBytes(report.junk.totalBytes)})`);
    out.push("");
    for (const file of report.junk.files) out.push(`- ${formatBytes(file.size)} \u2014 \`${shown(file)}\``);
    out.push("");
  }
  if (report.emptyDirCount > 0) {
    out.push(`## Empty directories (${report.emptyDirCount})`);
    out.push("");
    for (const dir of report.emptyDirs.slice(0, 50)) out.push(`- \`${toPosix(dir.path)}\``);
    out.push("");
  }
  out.push("---");
  out.push("");
  out.push(`Generated by [spacehog](https://github.com/d20260825613-hub/spacehog) v${report.tool.version}. Review before deleting.`);
  out.push("");
  return out.join("\n");
}
function renderJson(report, { pretty = false } = {}) {
  return JSON.stringify(report, null, pretty ? 2 : 0);
}

// src/cli.js
function defaultCachePath(env = process.env, platform = process.platform) {
  const home = import_node_os.default.homedir();
  if (platform === "win32") {
    const base2 = env.LOCALAPPDATA || env.APPDATA || import_node_path3.default.join(home, "AppData", "Local");
    return import_node_path3.default.join(base2, "spacehog", "hashes.json");
  }
  const base = env.XDG_CACHE_HOME || import_node_path3.default.join(home, ".cache");
  return import_node_path3.default.join(base, "spacehog", "hashes.json");
}
async function run(argv, io = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const env = io.env ?? process.env;
  const now = io.now ?? Date.now();
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    stderr.write(`spacehog: ${parsed.message}
`);
    stderr.write('Run "spacehog --help" for usage.\n');
    return 1;
  }
  const { values, paths } = parsed;
  if (values.help) {
    stdout.write(USAGE);
    return 0;
  }
  if (values.version) {
    stdout.write(`${VERSION}
`);
    return 0;
  }
  const roots = paths.map((p) => import_node_path3.default.resolve(p));
  const missing = roots.filter((root) => !safeExists(root));
  if (missing.length > 0) {
    for (const root of missing) stderr.write(`spacehog: cannot access ${root}
`);
    return 1;
  }
  const useColor = shouldUseColor({ flag: values.color, stream: stdout, env });
  const showProgress = values.progress ?? (Boolean(stderr.isTTY) && !values.json && !values.markdown && env.SPACEHOG_NO_PROGRESS === void 0);
  const exclude = buildExcludeFilter(values.exclude);
  const controller = new AbortController();
  const onSigint = () => {
    if (controller.signal.aborted) process.exit(130);
    stderr.write("\nspacehog: interrupted, writing partial report\u2026\n");
    controller.abort();
  };
  process.on("SIGINT", onSigint);
  const cachePath = values["no-cache"] ? null : values.cache ?? defaultCachePath(env);
  let progressLine = "";
  const reportProgress = (event) => {
    if (!showProgress) return;
    const parts = [];
    if (event.stage === "walking") {
      parts.push(`scanning: ${event.files ?? 0} files`, formatBytes(event.bytes ?? 0));
    } else if (event.stage === "duplicates") {
      const done = (event.checked?.headHashes ?? 0) + (event.checked?.fullHashes ?? 0);
      parts.push(`hashing: ${done} file(s)`);
    } else {
      parts.push(`${event.stage ?? "working"}\u2026`);
    }
    const line = `\x1B[2K\r${parts.join(" \xB7 ")}`;
    stderr.write(line);
    progressLine = line;
  };
  const reports = [];
  let exitCode = 0;
  try {
    for (const root of roots) {
      reports.push(
        await auditOne(root, {
          values,
          exclude,
          cachePath,
          signal: controller.signal,
          onProgress: reportProgress
        })
      );
    }
  } catch (error) {
    if (progressLine) stderr.write("\x1B[2K\r");
    stderr.write(`spacehog: ${error?.stack || error}
`);
    process.removeListener("SIGINT", onSigint);
    return 1;
  }
  if (progressLine) stderr.write("\x1B[2K\r");
  process.removeListener("SIGINT", onSigint);
  const threshold = values["fail-on-dupes"];
  if (threshold !== null && threshold !== void 0) {
    const wasted = reports.reduce((acc, report) => acc + (report.duplicates?.wastedBytes ?? 0), 0);
    if (wasted >= threshold) {
      exitCode = 2;
      stderr.write(
        `spacehog: duplicate waste ${formatBytes(wasted)} reached the --fail-on-dupes threshold ${formatBytes(threshold)}
`
      );
    }
  }
  const output = values.json || values.markdown ? reports.map(
    (report) => values.json ? renderJson(report, { pretty: values.pretty }) : renderMarkdown(report, { now })
  ).join("\n") : reports.map((report) => renderText(report, { color: useColor, width: stdout.columns, now })).join("\n");
  stdout.write(`${output}
`);
  return exitCode;
}
async function auditOne(root, { values, exclude, cachePath, signal, onProgress }) {
  const report = await audit({
    root,
    minSize: values["min-size"] ?? 0,
    top: values.top ?? 15,
    maxDepth: values["max-depth"] === null || values["max-depth"] === void 0 ? Infinity : values["max-depth"],
    includeHidden: values.hidden !== false,
    ignoreDirs: values["ignore-dirs"] !== false,
    followSymlinks: Boolean(values["follow-symlinks"]),
    maxEntries: values["max-entries"] ?? Infinity,
    duplicates: values.duplicates !== false,
    algorithm: values.hash ?? "md5",
    keepPolicy: values.keep ?? "newest",
    keepPrefer: values["keep-prefer"] ?? null,
    concurrency: values.concurrency ?? 8,
    maxHashSize: values["max-size"] ?? Infinity,
    cachePath,
    signal,
    onProgress
  });
  if (exclude && values.exclude?.length) {
    return applyExclude(report, exclude, values.exclude);
  }
  return report;
}
function applyExclude(report, isExcluded, patterns = []) {
  const keep = (file) => !isExcluded(toPosix(file.path));
  const duplicateGroups = report.duplicateGroups.map((group) => {
    const files = group.files.filter(keep);
    if (files.length < 2) return null;
    const wastedBytes2 = group.size * (files.length - 1);
    const suggestion = suggestKeep(files, group.keepPolicy ?? report.options?.keepPolicy ?? "newest", {
      prefer: group.keepPrefer ?? report.options?.keepPrefer ?? null
    });
    return {
      ...group,
      files,
      copies: files.length,
      wastedBytes: wastedBytes2,
      keep: suggestion.keep ? { path: suggestion.keep.path, display: suggestion.keep.display } : null,
      redundant: suggestion.redundant.map((file) => ({ path: file.path, display: file.display }))
    };
  }).filter(Boolean);
  const largeFiles = report.largeFiles.filter(keep);
  const sparse = report.sparse.filter(keep);
  const junkFiles = report.junk.files.filter(keep);
  const emptyDirs = report.emptyDirs.filter((dir) => !isExcluded(toPosix(dir.path)));
  const wastedBytes = duplicateGroups.reduce((acc, group) => acc + group.wastedBytes, 0);
  const duplicateFiles = duplicateGroups.reduce((acc, group) => acc + group.copies, 0);
  return {
    ...report,
    options: { ...report.options, exclude: patterns },
    duplicateGroups,
    largeFiles,
    sparse,
    emptyDirs,
    emptyDirCount: emptyDirs.length,
    junk: { ...report.junk, files: junkFiles, count: junkFiles.length },
    duplicates: { ...report.duplicates, wastedBytes, duplicateFiles, duplicateGroups: duplicateGroups.length }
  };
}
function safeExists(target) {
  try {
    import_node_fs2.default.accessSync(target);
    return true;
  } catch {
    return false;
  }
}

// tools/sea/entry-linux.mjs
run(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
}).catch((error) => {
  console.error("spacehog: " + (error && error.stack ? error.stack : error));
  process.exitCode = 1;
});
