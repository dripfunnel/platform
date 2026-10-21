import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import { childEnv, secretLikeNames } from './env'

vi.setConfig({ testTimeout: 30_000 })

const run = promisify(execFile)
const node = (script: string, args: string[], env: NodeJS.ProcessEnv) => run(process.execPath, ['--import', 'tsx', fileURLToPath(new URL(script, import.meta.url)), ...args], { env, encoding: 'utf8' })

describe('the sandbox reaches no network (AI-STUDIO §1, §8)', () => {
  it('fails every fetch, request, socket, lookup and WebSocket from inside, and the server sees no connection', async () => {
    let connections = 0
    const server = createServer((_req, res) => res.end('reached'))
    server.on('connection', () => (connections += 1))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const target = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
    try {
      const { stdout } = await node('./test/probe.ts', [target], { PATH: process.env['PATH'] ?? '' })
      expect(JSON.parse(stdout)).toEqual({ fetch: 'NetworkBlocked', http: 'NetworkBlocked', socket: 'NetworkBlocked', dns: 'NetworkBlocked', websocket: 'TypeError' })
      expect(connections).toBe(0)
    } finally {
      server.close()
    }
  })
})

describe('the sandbox holds no secret', () => {
  it('names every variable that looks like a credential', () => {
    expect(secretLikeNames({ GITHUB_PAT: 'x', CLOUDFLARE_API_TOKEN: 'x', DATABASE_URL: 'x', SES_SECRET_ACCESS_KEY: 'x', ANTHROPIC_API_KEY: 'x', PORT: '8080', PATH: '/bin', HOME: '/root', SANDBOX_SLOTS: '1' })).toEqual([
      'GITHUB_PAT',
      'CLOUDFLARE_API_TOKEN',
      'DATABASE_URL',
      'SES_SECRET_ACCESS_KEY',
      'ANTHROPIC_API_KEY',
    ])
  })

  it('refuses to start with a credential in its environment', async () => {
    const started = node('./main.ts', [], { PATH: process.env['PATH'] ?? '', GITHUB_PAT: 'ghp_not_a_real_token' })
    await expect(started).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('GITHUB_PAT') })
    await expect(started).rejects.not.toMatchObject({ stderr: expect.stringContaining('ghp_not_a_real_token') })
  })

  it('gives the programs it runs a path and a home of their own, nothing inherited', () => {
    expect(Object.keys(childEnv('/work/store'))).toEqual(['PATH', 'HOME', 'LANG'])
  })
})
