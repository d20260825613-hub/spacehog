import { HASH_ALGORITHMS, isSupportedAlgorithm } from './hash.js';
import { KEEP_POLICIES } from './keep.js';
import { parseSize } from './util.js';

/**
 * Hand-rolled argument parser (no dependencies).
 *
 * Supported shapes: --flag, --opt value, --opt=value, -o value, -o=value,
 * bundled short flags with a trailing value option (-nv), and `--`.
 */

const SPEC = {
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
  json: { type: 'boolean' },
  markdown: { type: 'boolean' },
  pretty: { type: 'boolean' },
  duplicates: { type: 'boolean', default: true, negatable: true },
  progress: { type: 'boolean', default: undefined, negatable: true },
  color: { type: 'boolean', default: undefined, negatable: true },
  hidden: { type: 'boolean', default: true, negatable: true },
  'ignore-dirs': { type: 'boolean', default: true, negatable: true },
  'follow-symlinks': { type: 'boolean', default: false, negatable: true },
  'no-cache': { type: 'boolean', default: false },
  top: { type: 'number', short: 'n', default: 15, min: 0 },
  'min-size': { type: 'size', short: 's', default: 0 },
  'max-size': { type: 'size', short: 'm', default: null },
  'max-depth': { type: 'number', default: null, min: 0 },
  'max-entries': { type: 'number', default: null, min: 1 },
  concurrency: { type: 'number', short: 'c', default: 8, min: 1 },
  hash: { type: 'string', short: 'a', default: 'md5', choices: HASH_ALGORITHMS },
  keep: { type: 'string', short: 'k', default: 'newest', choices: KEEP_POLICIES },
  'keep-prefer': { type: 'string', default: null },
  'fail-on-dupes': { type: 'size', default: null },
  exclude: { type: 'string', repeat: true, default: [] },
  cache: { type: 'string', default: null },
};

const ALIASES = new Map();
for (const [name, def] of Object.entries(SPEC)) {
  if (def.short) ALIASES.set(def.short, name);
}

export const USAGE = `spacehog — find out what is eating your disk

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

/**
 * @param {string[]} argv arguments *after* the node executable and script
 * @returns {{ok: true, values: object, paths: string[]} | {ok: false, message: string}}
 */
export function parseArgs(argv) {
  const values = {};
  for (const [name, def] of Object.entries(SPEC)) {
    if (def.default !== undefined) values[name] = def.repeat ? [...def.default] : def.default;
  }
  const paths = [];
  const args = [...argv];
  let onlyPositional = false;

  while (args.length > 0) {
    const token = args.shift();
    if (onlyPositional || token === '-' || !token.startsWith('-')) {
      paths.push(token);
      continue;
    }
    if (token === '--') {
      onlyPositional = true;
      continue;
    }

    let name = null;
    let inline = null;
    let inlineProvided = false;

    if (token.startsWith('--')) {
      let body = token.slice(2);
      const eq = body.indexOf('=');
      if (eq >= 0) {
        inline = body.slice(eq + 1);
        inlineProvided = true;
        body = body.slice(0, eq);
      }
      if (body.startsWith('no-') && SPEC[body.slice(3)]?.negatable) {
        values[body.slice(3)] = false;
        continue;
      }
      name = body;
      if (!SPEC[name]) return fail(`unknown option: --${name}`);
    } else {
      // Short flags, possibly bundled (-vh) or glued to a value (-n20).
      const chars = [...token.slice(1)];
      let pendingValue = null;
      for (let i = 0; i < chars.length; i += 1) {
        const mapped = ALIASES.get(chars[i]);
        if (!mapped) return fail(`unknown option: -${chars[i]}`);
        const def = SPEC[mapped];
        const rest = chars.slice(i + 1).join('');
        if (def.type === 'boolean') {
          values[mapped] = true;
          continue;
        }
        if (rest.length > 0) {
          name = mapped;
          inline = rest.replace(/^=/, '');
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
    if (def.type === 'boolean') {
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

  if (paths.length === 0) paths.push('.');

  if (!isSupportedAlgorithm(values.hash)) {
    return fail(`unsupported hash algorithm: ${values.hash} (expected ${HASH_ALGORITHMS.join(', ')})`);
  }

  return { ok: true, values, paths };
}

function applyValue(values, name, def, raw) {
  switch (def.type) {
    case 'string': {
      const value = String(raw);
      if (def.choices && !def.choices.includes(value.toLowerCase())) {
        return fail(`--${name} must be one of: ${def.choices.join(', ')}`);
      }
      values[name] = def.choices ? value.toLowerCase() : value;
      return null;
    }
    case 'number': {
      const value = Number(raw);
      if (!Number.isFinite(value)) return fail(`--${name} expects a number, got "${raw}"`);
      if (def.min !== undefined && value < def.min) return fail(`--${name} must be >= ${def.min}`);
      values[name] = Math.floor(value);
      return null;
    }
    case 'size': {
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

/**
 * Translate a glob into a RegExp anchored at both ends.
 *
 * Supported: `*` (any run of characters except `/`), `**` (any run including
 * `/`), `?` (one character except `/`), and `{a,b}` alternatives. A pattern
 * with no `/` matches the basename at any depth, so `--exclude '*.tmp'` and
 * `--exclude '**\/*.tmp'` behave the same.
 */
export function globToRegExp(pattern) {
  const source = String(pattern).split('\\').join('/');
  const normalized = source.includes('/') ? source : `**/${source}`;
  let out = '';
  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];
    if (char === '*') {
      if (normalized[i + 1] === '*') {
        if (normalized[i + 2] === '/') {
          // `**/` also matches zero directories: a/**/z matches a/z.
          out += '(?:.*/)?';
          i += 2;
        } else {
          out += '.*';
          i += 1;
        }
      } else {
        out += '[^/]*';
      }
      continue;
    }
    if (char === '?') {
      out += '[^/]';
      continue;
    }
    if (char === '{') {
      const end = normalized.indexOf('}', i);
      if (end > i) {
        const options = normalized
          .slice(i + 1, end)
          .split(',')
          .map((option) => option.replace(/[.+^${}()|[\]\\]/g, '\\$&'));
        out += `(?:${options.join('|')})`;
        i = end;
        continue;
      }
    }
    out += char.replace(/[.+^${}()|[\]\\]/, '\\$&');
  }
  return new RegExp(`^${out}$`, process.platform === 'win32' ? 'i' : '');
}

export function buildExcludeFilter(patterns) {
  if (!patterns || patterns.length === 0) return () => false;
  const regexes = patterns.map(globToRegExp);
  return (posixPath) => regexes.some((re) => re.test(posixPath));
}
