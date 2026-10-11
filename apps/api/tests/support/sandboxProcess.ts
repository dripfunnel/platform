import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { localSandboxHost, type SandboxHost } from '#integrations/sandbox/index'

// apps/sandbox run as the local stand-in runs it (docs/setup/local.md): its own Node process with an empty environment,
// real git and the real fast gate, reached over HTTP. Never imported: the API knows it only by its operations.
const main = fileURLToPath(new URL('../../../sandbox/src/main.ts', import.meta.url))

const freePort = () =>
  new Promise<number>((resolve) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => resolve(typeof address === 'object' && address ? address.port : 0))
    })
  })

export interface SandboxProcess extends SandboxHost {
  /** Kills the process at once, as a container dying mid-change would. */
  kill: () => void
  starts: () => number
  close: () => Promise<void>
}

export const sandboxProcess = async (): Promise<SandboxProcess> => {
  const work = await mkdtemp(join(tmpdir(), 'studio-sandbox-'))
  const port = await freePort()
  let child: ChildProcess | null = null
  let starts = 0
  let runtimeBuilt = false
  const local = localSandboxHost(`http://127.0.0.1:${port}`)
  const kill = () => {
    child?.kill('SIGKILL')
    child = null
  }
  return {
    send: local.send,
    running: () => child !== null && child.exitCode === null,
    start: async () => {
      if (!child || child.exitCode !== null) {
        starts += 1
        const env = { PATH: process.env['PATH'] ?? '', PORT: String(port), SANDBOX_SLOTS: '10', SANDBOX_WORK: join(work, `run-${starts}`), ...(runtimeBuilt ? { SANDBOX_RUNTIME: join(work, 'run-1', 'runtime') } : {}) }
        child = spawn(process.execPath, ['--import', 'tsx', main], { env, stdio: 'ignore' })
      }
      await local.start()
      runtimeBuilt = true
    },
    stop: async () => kill(),
    kill,
    starts: () => starts,
    close: async () => {
      kill()
      await rm(work, { recursive: true, force: true })
    },
  }
}
