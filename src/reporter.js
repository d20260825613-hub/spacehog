import {
  clamp,
  ellipsize,
  formatAge,
  formatBytes,
  formatDuration,
  toPosix,
} from './util.js';
import { explainKeep } from './keep.js';

const RULE_WIDTH = 72;

const PALETTE = {
  bold: [1, 22],
  dim: [2, 22],
  red: [31, 39],
  green: [32, 39],
  yellow: [33, 39],
  blue: [34, 39],
  magenta: [35, 39],
  cyan: [36, 39],
  gray: [90, 39],
};

/** Create a `paint(text, ...styles)` function; a no-op when disabled. */
export function createColors(enabled) {
  if (!enabled) {
    const identity = (text) => String(text);
    return new Proxy(identity, {
      get: () => identity,
      apply: (_t, _s, args) => String(args[0]),
    });
  }
  return new Proxy((text, ...styles) => applyStyles(text, styles), {
    get: (_target, prop) => (text, ...styles) => applyStyles(text, [prop, ...styles]),
    apply: (_target, _this, args) => applyStyles(args[0], args.slice(1)),
  });
}

function applyStyles(text, styles) {
  let codes = '';
  for (const style of styles.flat()) {
    const code = PALETTE[style];
    if (code) codes += `\u001B[${code[0]}m`;
  }
  if (!codes) return String(text);
  return `${codes}${text}\u001B[0m`;
}

/** Decide whether ANSI colors should be emitted. */
export function shouldUseColor({ flag, stream = process.stdout, env = process.env } = {}) {
  if (flag === true) return true;
  if (flag === false) return false;
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return false;
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== '' && env.FORCE_COLOR !== '0') return true;
  if (env.TERM === 'dumb') return false;
  return Boolean(stream.isTTY);
}

export function terminalWidth(stream = process.stdout) {
  const width = stream?.columns;
  return Number.isFinite(width) && width > 20 ? Math.min(width, 160) : 100;
}

const SEVERITY = {
  high: (c) => c.red('HIGH'),
  medium: (c) => c.yellow('MEDIUM'),
  low: (c) => c.cyan('LOW'),
  info: (c) => c.gray('INFO'),
};

/**
 * Compute the headline numbers plus a rough "attention" verdict.
 */
export function summarize(report, now = Date.now()) {
  const duplicates = report.duplicates ?? {};
  const wasted = duplicates.wastedBytes ?? 0;
  const junk = report.junk?.totalBytes ?? 0;
  const hardlinkSaved = report.hardlinkSavedBytes ?? 0;
  const sparseSaved = (report.sparse ?? []).reduce((acc, file) => acc + (file.savedBytes ?? 0), 0);
  const total = report.summary.totalBytes || 0;
  const reclaimable = wasted + junk;

  let severity = 'info';
  let headline = 'This tree looks tidy — nothing obvious to reclaim.';
  const share = total > 0 ? reclaimable / total : 0;
  if (reclaimable > 0) {
    if (reclaimable >= 1024 ** 3 || share >= 0.1) {
      severity = 'high';
      headline = `About ${formatBytes(reclaimable)} looks reclaimable (${pct(share)} of the tree).`;
    } else if (reclaimable >= 100 * 1024 ** 2) {
      severity = 'medium';
      headline = `${formatBytes(reclaimable)} of duplicates and junk found.`;
    } else {
      severity = 'low';
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
    now,
  };
}

function pct(value) {
  if (!Number.isFinite(value) || value <= 0) return '0%';
  const p = value * 100;
  return `${p < 1 ? p.toFixed(1) : Math.round(p)}%`;
}

/* ------------------------------------------------------------------ *
 * Text report
 * ------------------------------------------------------------------ */

export function renderText(report, { color = false, width = 100, now = Date.now() } = {}) {
  const c = createColors(color);
  const s = summarize(report, now);
  const out = [];
  const rule = (title = '') => {
    const label = title ? ` ${title} ` : '';
    const side = Math.max(0, RULE_WIDTH - label.length);
    const left = Math.floor(side / 2);
    out.push(c.gray('─'.repeat(left) + label + '─'.repeat(side - left)));
  };

  out.push('');
  out.push(`${c.bold('spacehog')} ${c.gray(`v${report.tool.version}`)} ${c.dim('·')} ${c.dim(report.root)}`);
  rule();
  out.push(
    [
      `${c.bold(formatBytes(s.total))} scanned`,
      c.dim('·'),
      `${report.summary.files} files`,
      c.dim('·'),
      `${report.summary.directories} dirs`,
      c.dim('·'),
      formatDuration(report.summary.durationMs),
    ].join(' '),
  );
  out.push(`${SEVERITY[s.severity](c)}  ${s.headline}`);
  out.push('');

  if (report.summary.errorCount > 0) {
    out.push(c.yellow(`! ${report.summary.errorCount} path(s) could not be read — run with --json for details`));
    out.push('');
  }
  if (report.summary.truncated) {
    out.push(c.yellow('! file limit reached (--max-entries); the report is partial'));
    out.push('');
  }

  renderDuplicates(out, report, c, now);
  renderLargeFiles(out, report, c, now);
  renderJunk(out, report, c);
  renderSparse(out, report, c, now);
  renderEmptyDirs(out, report, c, width);

  rule('next steps');
  out.push(c.dim('  Review before deleting: spacehog only reports, it never removes files.'));
  if (s.wasted > 0) {
    out.push(c.dim(`  Machine-readable copies: ${c.cyan('spacehog . --json')} → duplicateGroups[].files[]`));
  }
  if (report.cacheCandidates?.enabled) {
    const cache = report.cacheCandidates;
    out.push(
      c.dim(`  Hash cache: ${cache.hits} hit(s), ${cache.misses} miss(es)${cache.saved ? ', saved' : ''}`),
    );
  }
  out.push('');
  return out.join('\n');
}

function renderDuplicates(out, report, c, now) {
  const stats = report.duplicates ?? {};
  const groups = report.duplicateGroups ?? [];
  const title = `duplicates · ${formatBytes(stats.wastedBytes ?? 0)} reclaimable`;
  out.push(`${c.bold('▌ duplicates')} ${c.dim(`· ${groups.length} group(s) · ${stats.duplicateFiles ?? 0} file(s)`)}`);
  if (groups.length === 0) {
    out.push(c.green('  ✓ no duplicate content found'));
    out.push('');
    return;
  }
  out.push(c.dim(`  ${title}`));
  out.push(c.dim(`  paths below are relative to ${toPosix(report.root)}`));
  if (groups.some((group) => group.keep)) {
    out.push(
      c.dim(
        `  ${c.green('keep')} marks the copy to keep — ${explainKeep(
          report.options?.keepPolicy ?? groups[0].keepPolicy ?? 'newest',
          report.options?.keepPrefer ?? null,
        )}`,
      ),
    );
  }
  groups.forEach((group, index) => {
    const marker = index === 0 ? c.red('●') : c.gray('○');
    out.push(
      `  ${marker} ${c.bold(formatBytes(group.size))} × ${group.copies} ${c.gray(`→ save ${formatBytes(group.wastedBytes)}`)}`,
    );
    out.push(c.dim(`     ${group.algorithm}:${String(group.hash).slice(0, 12)}`));
    const keeperPath = group.keep?.path ?? null;
    for (const file of group.files) {
      const isKeeper = keeperPath !== null && file.path === keeperPath;
      // The keeper is annotated in place, so the relative paths stay aligned
      // and a reader can act on the group without cross-referencing anything.
      const tag = isKeeper ? ` ${c.green('← keep')}` : '';
      out.push(
        `     ${isKeeper ? c.green('·') : c.dim('·')} ${file.display ?? toPosix(file.path)}${tag} ${c.gray(
          `(${formatAge(file.mtimeMs, now)})`,
        )}`,
      );
    }
    if (keeperPath === null && group.files.length > 1) {
      out.push(c.dim('     (no keep suggestion for this group)'));
    }
  });
  if ((report.hardlinkSavedBytes ?? 0) > 0) {
    out.push(
      c.dim(
        `  note: ${formatBytes(report.hardlinkSavedBytes)} more is shared through hard links — those bytes are stored only once.`,
      ),
    );
  }
  out.push('');
}

function renderLargeFiles(out, report, c, now) {
  const files = report.largeFiles ?? [];
  out.push(`${c.bold('▌ largest files')} ${c.dim(`· top ${files.length}`)}`);
  if (files.length === 0) {
    out.push(c.dim('  (none)'));
    out.push('');
    return;
  }
  const width = Math.max(...files.map((file) => String(file.display).length), 10);
  const column = Math.min(width, 64);
  files.forEach((file, index) => {
    const size = formatBytes(file.size).padStart(9);
    const rank = String(index + 1).padStart(2);
    const label = ellipsize(file.display, column).padEnd(column);
    out.push(
      `  ${c.gray(rank)} ${c.bold(size)}  ${label} ${c.gray(`${formatAge(file.mtimeMs, now)}${file.sparse ? ' · sparse' : ''}`)}`,
    );
  });
  out.push('');
}

function renderJunk(out, report, c) {
  const junk = report.junk ?? { files: [], count: 0, totalBytes: 0 };
  out.push(`${c.bold('▌ junk')} ${c.dim(`· ${junk.count} file(s) · ${formatBytes(junk.totalBytes)}`)}`);
  if (junk.count === 0) {
    out.push(c.green('  ✓ no obvious junk files'));
    out.push('');
    return;
  }
  for (const file of junk.files) {
    out.push(`  ${c.yellow('·')} ${formatBytes(file.size).padStart(9)}  ${ellipsize(file.display ?? toPosix(file.path), 80)}`);
  }
  if (junk.count > junk.files.length) {
    out.push(c.dim(`  … and ${junk.count - junk.files.length} more (raise --top to see them)`));
  }
  out.push(c.dim('  Junk is regenerable by definition, but check the list: .log and .bak can matter.'));
  out.push('');
}

function renderSparse(out, report, c, now) {
  const sparse = report.sparse ?? [];
  if (sparse.length === 0) return;
  out.push(`${c.bold('▌ sparse files')} ${c.dim('· allocated far less than their logical size')}`);
  for (const file of sparse) {
    out.push(
      `  ${c.magenta('·')} ${formatBytes(file.size).padStart(9)} ${c.gray(`(real: ${formatBytes(file.allocatedBytes)})`)}  ${ellipsize(file.display ?? toPosix(file.path), 70)}`,
    );
  }
  out.push(c.dim(`  ${formatAge(sparse[0].mtimeMs, now)} · these are not free space to reclaim, just context.`));
  out.push('');
}

function renderEmptyDirs(out, report, c, width) {
  const dirs = report.emptyDirs ?? [];
  out.push(`${c.bold('▌ empty directories')} ${c.dim(`· ${report.emptyDirCount ?? dirs.length}`)}`);
  if (dirs.length === 0) {
    out.push(c.green('  ✓ none'));
    out.push('');
    return;
  }
  for (const dir of dirs.slice(0, 15)) {
    out.push(`  ${c.blue('·')} ${ellipsize(dir.display, Math.max(20, width - 8))}`);
  }
  if (dirs.length > 15) out.push(c.dim(`  … and ${dirs.length - 15} more`));
  out.push('');
}

/* ------------------------------------------------------------------ *
 * Markdown report
 * ------------------------------------------------------------------ */

export function renderMarkdown(report, { now = Date.now() } = {}) {
  const s = summarize(report, now);
  const out = [];
  const esc = (text) => String(text).replace(/\|/g, '\\|');
  const shown = (file) => esc(file.display ?? toPosix(file.path));

  out.push(`# spacehog report`);
  out.push('');
  out.push(`- **Root:** \`${toPosix(report.root)}\``);
  out.push(`- **Generated:** ${report.generatedAt}`);
  out.push(`- **Scanned:** ${formatBytes(s.total)} across ${report.summary.files} files in ${report.summary.directories} directories (${formatDuration(report.summary.durationMs)})`);
  out.push(`- **Reclaimable:** ${formatBytes(s.reclaimable)} — duplicates ${formatBytes(s.wasted)}, junk ${formatBytes(s.junk)}`);
  out.push('');
  out.push(`> ${s.headline}`);
  out.push('');

  if (s.wasted > 0) {
    out.push('## Duplicates');
    out.push('');
    out.push('| Size | Copies | Reclaimable | Sample path |');
    out.push('| ---: | ---: | ---: | --- |');
    for (const group of report.duplicateGroups.slice(0, 25)) {
      out.push(
        `| ${formatBytes(group.size)} | ${group.copies} | ${formatBytes(group.wastedBytes)} | \`${ellipsize(shown(group.files[0]), 80)}\` |`,
      );
    }
    out.push('');
    for (const [index, group] of report.duplicateGroups.slice(0, 10).entries()) {
      out.push(`<details><summary>Group ${index + 1} — ${formatBytes(group.size)} × ${group.copies}</summary>`);
      out.push('');
      const keeperPath = group.keep?.path ?? null;
      for (const file of group.files) {
        const isKeeper = keeperPath !== null && file.path === keeperPath;
        out.push(`- \`${shown(file)}\`${isKeeper ? ' ← **keep this one**' : ''}`);
      }
      out.push('');
      out.push('</details>');
      out.push('');
    }
  }

  if (report.largeFiles.length > 0) {
    out.push('## Largest files');
    out.push('');
    out.push('| Size | File | Modified |');
    out.push('| ---: | --- | --- |');
    for (const file of report.largeFiles) {
      out.push(`| ${formatBytes(file.size)} | \`${shown(file)}\` | ${formatAge(file.mtimeMs, now)} |`);
    }
    out.push('');
  }

  if (report.junk.count > 0) {
    out.push(`## Junk (${report.junk.count} files, ${formatBytes(report.junk.totalBytes)})`);
    out.push('');
    for (const file of report.junk.files) out.push(`- ${formatBytes(file.size)} — \`${shown(file)}\``);
    out.push('');
  }

  if (report.emptyDirCount > 0) {
    out.push(`## Empty directories (${report.emptyDirCount})`);
    out.push('');
    for (const dir of report.emptyDirs.slice(0, 50)) out.push(`- \`${toPosix(dir.path)}\``);
    out.push('');
  }

  out.push('---');
  out.push('');
  out.push(`Generated by [spacehog](https://github.com/d20260825613-hub/spacehog) v${report.tool.version}. Review before deleting.`);
  out.push('');
  return out.join('\n');
}

/* ------------------------------------------------------------------ *
 * JSON report
 * ------------------------------------------------------------------ */

export function renderJson(report, { pretty = false } = {}) {
  return JSON.stringify(report, null, pretty ? 2 : 0);
}

export { clamp };
