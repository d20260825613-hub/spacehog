/**
 * Small, dependency-free helpers shared across spacehog.
 * Everything here is pure and unit-testable.
 */

export const VERSION = '0.1.0';

/* ------------------------------------------------------------------ *
 * Byte formatting
 * ------------------------------------------------------------------ */

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

/**
 * Human readable byte size using binary (1024) steps.
 *
 * formatBytes(0)      -> "0 B"
 * formatBytes(1536)   -> "1.5 KB"
 * formatBytes(1048576)-> "1 MB"
 */
export function formatBytes(bytes, { space = true } = {}) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return '0 B';
  if (n === 0) return `0${space ? ' ' : ''}B`;
  const exp = Math.min(Math.floor(Math.log(n) / Math.log(1024)), BYTE_UNITS.length - 1);
  const value = n / 1024 ** exp;
  // 3 significant digits, but keep integers clean: 2.00 -> 2
  const rounded = value >= 100 || exp === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded}${space ? ' ' : ''}${BYTE_UNITS[exp]}`;
}

/**
 * Parse a human size string ("10", "10b", "1.5mb", "2 GB") into bytes.
 * A bare number means bytes. Returns null when the input is unusable.
 */
export function parseSize(input) {
  if (typeof input === 'number') return Number.isFinite(input) && input >= 0 ? Math.floor(input) : null;
  if (typeof input !== 'string') return null;
  const m = /^\s*(\d+(?:\.\d+)?)\s*([a-zA-Z]*)\s*$/.exec(input);
  if (!m) return null;
  const value = Number(m[1]);
  const unit = m[2].toLowerCase();
  if (!Number.isFinite(value)) return null;
  if (unit === '' || unit === 'b' || unit === 'byte' || unit === 'bytes') return Math.floor(value);
  const index = BYTE_UNITS.findIndex((u) => u.toLowerCase() === unit || `${u.toLowerCase()}b` === unit);
  if (index <= 0) return null;
  return Math.floor(value * 1024 ** index);
}

/* ------------------------------------------------------------------ *
 * Path helpers
 * ------------------------------------------------------------------ */

/** Normalize to forward slashes; the report format never depends on the OS. */
export function toPosix(p) {
  return String(p).split('\\').join('/');
}

/** Longest common leading directory of the given paths, or '' when there is none. */
export function commonRoot(paths) {
  if (paths.length === 0) return '';
  const parts = toPosix(paths[0]).split('/');
  let end = parts.length;
  for (const p of paths.slice(1)) {
    const other = toPosix(p).split('/');
    let i = 0;
    while (i < end && i < other.length && parts[i] === other[i]) i += 1;
    end = i;
    if (end === 0) return '';
  }
  return parts.slice(0, end).join('/');
}

/* ------------------------------------------------------------------ *
 * Numeric helpers
 * ------------------------------------------------------------------ */

export function sum(values) {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

/** Clamp to [min, max]. */
export function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}

/** Truncate a string in the middle so long paths stay recognizable. */
export function ellipsize(text, max) {
  const s = String(text);
  if (!Number.isFinite(max) || max < 4 || s.length <= max) return s;
  const keep = max - 1;
  const head = Math.ceil(keep / 2);
  const tail = keep - head;
  return `${s.slice(0, head)}…${s.slice(s.length - tail)}`;
}

/* ------------------------------------------------------------------ *
 * Time helpers
 * ------------------------------------------------------------------ */

export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '0ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 2 : 1)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m${String(s).padStart(2, '0')}s`;
}

/** ISO date (UTC) without milliseconds — stable across platforms for tests. */
export function isoNow(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Relative age such as "3d ago", "5mo ago". */
export function formatAge(mtimeMs, now = Date.now()) {
  if (!Number.isFinite(mtimeMs) || mtimeMs <= 0) return 'unknown';
  const diff = Math.max(0, now - mtimeMs);
  const day = 86_400_000;
  const days = Math.floor(diff / day);
  if (days === 0) {
    const hours = Math.floor(diff / 3_600_000);
    if (hours === 0) {
      const minutes = Math.floor(diff / 60_000);
      return minutes <= 0 ? 'just now' : `${minutes}m ago`;
    }
    return `${hours}h ago`;
  }
  if (days < 31) return `${days}d ago`;
  const months = Math.floor(days / 30.44);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(days / 365.25)}y ago`;
}
