import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildExcludeFilter, parseArgs, USAGE } from './args.js';
import { audit } from './audit.js';
import { UsageError, formatError } from './cli-kit.js';
import { suggestKeep } from './keep.js';
import { renderJson, renderMarkdown, renderText, shouldUseColor } from './reporter.js';
import { formatBytes, parseSize, toPosix, VERSION } from './util.js';

export { parseArgs, USAGE } from './args.js';
export { audit } from './audit.js';
export { renderJson, renderMarkdown, renderText, summarize } from './reporter.js';

/** Resolve the per-user cache directory in a cross-platform way. */
export function defaultCachePath(env = process.env, platform = process.platform) {
  const home = os.homedir();
  if (platform === 'win32') {
    const base = env.LOCALAPPDATA || env.APPDATA || path.join(home, 'AppData', 'Local');
    return path.join(base, 'spacehog', 'hashes.json');
  }
  const base = env.XDG_CACHE_HOME || path.join(home, '.cache');
  return path.join(base, 'spacehog', 'hashes.json');
}

/**
 * Run the CLI. Returns the process exit code.
 *
 * @param {string[]} argv arguments after the script name
 * @param {object} [io] injectable streams for tests
 */
export async function run(argv, io = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const env = io.env ?? process.env;
  const now = io.now ?? Date.now();

  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    // 2 means the arguments were wrong, 1 means the operation failed. A caller
    // can then tell "I typed it badly" from "the scan hit a problem" instead of
    // retrying something that can never work.
    stderr.write(formatError(new UsageError(parsed.message, { hint: parsed.hint }), { tool: 'spacehog' }));
    return 2;
  }
  const { values, paths } = parsed;

  if (values.help) {
    stdout.write(USAGE);
    return 0;
  }
  if (values.version) {
    stdout.write(`${VERSION}\n`);
    return 0;
  }

  const roots = paths.map((p) => path.resolve(p));
  const missing = roots.filter((root) => !safeExists(root));
  if (missing.length > 0) {
    // A path that cannot be reached from a working directory is an argument
    // problem: the user named something that is not there. Code 1 is reserved
    // for a scan that started and then failed.
    for (const root of missing) {
      stderr.write(
        formatError(
          new UsageError(`cannot access ${root}`, {
            hint: 'check the path, or run with --help for usage',
          }),
          { tool: 'spacehog' },
        ),
      );
    }
    return 2;
  }

  const useColor = shouldUseColor({ flag: values.color, stream: stdout, env });
  const showProgress =
    values.progress ?? (Boolean(stderr.isTTY) && !values.json && !values.markdown && env.SPACEHOG_NO_PROGRESS === undefined);

  const exclude = buildExcludeFilter(values.exclude);
  const controller = new AbortController();
  const onSigint = () => {
    if (controller.signal.aborted) process.exit(130);
    stderr.write('\nspacehog: interrupted, writing partial report…\n');
    controller.abort();
  };
  process.on('SIGINT', onSigint);

  const cachePath = values['no-cache'] ? null : values.cache ?? defaultCachePath(env);

  let progressLine = '';
  const reportProgress = (event) => {
    if (!showProgress) return;
    const parts = [];
    if (event.stage === 'walking') {
      parts.push(`scanning: ${event.files ?? 0} files`, formatBytes(event.bytes ?? 0));
    } else if (event.stage === 'duplicates') {
      const done = (event.checked?.headHashes ?? 0) + (event.checked?.fullHashes ?? 0);
      parts.push(`hashing: ${done} file(s)`);
    } else {
      parts.push(`${event.stage ?? 'working'}…`);
    }
    const line = `\u001B[2K\r${parts.join(' · ')}`;
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
          onProgress: reportProgress,
        }),
      );
    }
  } catch (error) {
    if (progressLine) stderr.write('\u001B[2K\r');
    stderr.write(`spacehog: ${error?.stack || error}\n`);
    process.removeListener('SIGINT', onSigint);
    return 1;
  }

  if (progressLine) stderr.write('\u001B[2K\r');
  process.removeListener('SIGINT', onSigint);

  const threshold = values['fail-on-dupes'];
  if (threshold !== null && threshold !== undefined) {
    const wasted = reports.reduce((acc, report) => acc + (report.duplicates?.wastedBytes ?? 0), 0);
    if (wasted >= threshold) {
      exitCode = 2;
      stderr.write(
        `spacehog: duplicate waste ${formatBytes(wasted)} reached the --fail-on-dupes threshold ${formatBytes(threshold)}\n`,
      );
    }
  }

  const output =
    values.json || values.markdown
      ? reports
          .map((report) =>
            values.json ? renderJson(report, { pretty: values.pretty }) : renderMarkdown(report, { now }),
          )
          .join('\n')
      : reports.map((report) => renderText(report, { color: useColor, width: stdout.columns, now })).join('\n');

  stdout.write(`${output}\n`);
  return exitCode;
}

async function auditOne(root, { values, exclude, cachePath, signal, onProgress }) {
  const report = await audit({
    root,
    minSize: values['min-size'] ?? 0,
    top: values.top ?? 15,
    maxDepth: values['max-depth'] === null || values['max-depth'] === undefined ? Infinity : values['max-depth'],
    includeHidden: values.hidden !== false,
    ignoreDirs: values['ignore-dirs'] !== false,
    followSymlinks: Boolean(values['follow-symlinks']),
    maxEntries: values['max-entries'] ?? Infinity,
    duplicates: values.duplicates !== false,
    algorithm: values.hash ?? 'md5',
    keepPolicy: values.keep ?? 'newest',
    keepPrefer: values['keep-prefer'] ?? null,
    concurrency: values.concurrency ?? 8,
    maxHashSize: values['max-size'] ?? Infinity,
    cachePath,
    signal,
    onProgress,
  });

  if (exclude && values.exclude?.length) {
    return applyExclude(report, exclude, values.exclude);
  }
  return report;
}

/**
 * Post-filter a report with `--exclude` globs.
 *
 * Exclusion happens after the walk (so directory pruning still counts toward
 * totals); it removes matching entries from every section and recomputes the
 * derived numbers, which keeps `--json` output self-consistent.
 *
 * The keep suggestion is recomputed too: if the excluded file was the one we
 * suggested keeping, pointing at a path that is no longer in the report would
 * be wrong.
 */
export function applyExclude(report, isExcluded, patterns = []) {
  const keep = (file) => !isExcluded(toPosix(file.path));

  const duplicateGroups = report.duplicateGroups
    .map((group) => {
      const files = group.files.filter(keep);
      if (files.length < 2) return null;
      const wastedBytes = group.size * (files.length - 1);
      const suggestion = suggestKeep(files, group.keepPolicy ?? report.options?.keepPolicy ?? 'newest', {
        prefer: group.keepPrefer ?? report.options?.keepPrefer ?? null,
      });
      return {
        ...group,
        files,
        copies: files.length,
        wastedBytes,
        keep: suggestion.keep ? { path: suggestion.keep.path, display: suggestion.keep.display } : null,
        redundant: suggestion.redundant.map((file) => ({ path: file.path, display: file.display })),
      };
    })
    .filter(Boolean);

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
    duplicates: { ...report.duplicates, wastedBytes, duplicateFiles, duplicateGroups: duplicateGroups.length },
  };
}

function safeExists(target) {
  try {
    fs.accessSync(target);
    return true;
  } catch {
    return false;
  }
}

export { parseSize };
