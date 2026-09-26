import { spawnSync } from 'node:child_process';

const CLI_MODULE = new URL('../../src/cli.js', import.meta.url).href;

/**
 * Run the real bin/spacehog.js and always resolve.
 *
 * Prefers a genuine child process. Some sandboxes deny the stdio pipes that
 * `spawnSync` needs (EPERM); there we import the CLI and call `run()` in this
 * process instead, which exercises the same code path minus OS argument passing.
 *
 * @returns {Promise<{code: number, stdout: string, stderr: string, viaSpawn: boolean}>}
 */
export async function runCli(cliPath, args, { cwd, env } = {}) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  if (!result.error) {
    return { code: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '', viaSpawn: true };
  }
  return runCliInProcess(args, { env });
}

async function runCliInProcess(args, { env = {} } = {}) {
  const { run } = await import(CLI_MODULE);
  let stdout = '';
  let stderr = '';
  const code = await run(args, {
    stdout: { isTTY: false, columns: 100, write: (chunk) => ((stdout += String(chunk)), true) },
    stderr: { isTTY: false, columns: 100, write: (chunk) => ((stderr += String(chunk)), true) },
    env: { ...process.env, ...env },
  });
  return { code, stdout, stderr, viaSpawn: false };
}
