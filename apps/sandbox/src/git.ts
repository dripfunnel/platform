import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { childEnv } from './env'

const run = promisify(execFile)

// Every commit in the private draft is the platform's (storefront AI-STUDIO §4 step 4); git reads no config of its own.
const identity = {
  GIT_AUTHOR_NAME: 'DripFunnel',
  GIT_AUTHOR_EMAIL: 'noreply@dripfunnel.com',
  GIT_COMMITTER_NAME: 'DripFunnel',
  GIT_COMMITTER_EMAIL: 'noreply@dripfunnel.com',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_TERMINAL_PROMPT: '0',
  GIT_ALLOW_PROTOCOL: 'file',
}

export type Git = (args: readonly string[]) => Promise<string>

/** git in one folder, with the sandbox's empty environment; `home` is the slot's own folder. */
export const gitIn =
  (cwd: string, home: string): Git =>
  async (args) => {
    const { stdout } = await run('git', ['-c', 'core.symlinks=false', '-c', 'core.hooksPath=/dev/null', ...args], {
      cwd,
      env: { ...childEnv(home), ...identity },
      maxBuffer: 64 * 1024 * 1024,
      encoding: 'utf8',
    })
    return stdout
  }
