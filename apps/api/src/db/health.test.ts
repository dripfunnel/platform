/// <reference types="node" />
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import net, { createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import tls from 'node:tls'
import { describe, expect, it } from 'vitest'
import type { Config } from '#core/config'
import { getClient } from './client'
import { checkHealth, ping } from './health'

// eslint-disable-next-line no-restricted-globals -- test-only Node process, this file never runs in the Worker
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://dripfunnel_dev:dripfunnel_dev@localhost:5432/dripfunnel'
const ctx = { waitUntil: (promise: Promise<unknown>) => promise } as unknown as ExecutionContext

describe('ping', () => {
  it('is healthy against a real Postgres', async () => {
    const sql = getClient({ connectionString: DATABASE_URL }, { max: 1 })
    try {
      expect(await ping(sql)).toBe(true)
    } finally {
      await sql.end()
    }
  })

  it('is unhealthy when the connection is refused', async () => {
    const sql = getClient({ connectionString: 'postgres://dripfunnel_dev:dripfunnel_dev@localhost:1/dripfunnel' }, { max: 1 })
    try {
      expect(await ping(sql)).toBe(false)
    } finally {
      await sql.end()
    }
  })

  it('is unhealthy when the query breaches statement_timeout', async () => {
    const sql = getClient({ connectionString: DATABASE_URL }, { max: 1, statementTimeoutMs: 50 })
    try {
      expect(await ping(sql, () => sql`select pg_sleep(1)`)).toBe(false)
    } finally {
      await sql.end()
    }
  })

  it('is unhealthy without hanging on an unreachable host that never completes the connection', async () => {
    const server = createServer((socket) => socket.on('data', () => {}))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as { port: number }
    const sql = getClient({ connectionString: `postgres://u:p@127.0.0.1:${port}/db` }, { max: 1, connectTimeoutMs: 200 })
    try {
      const start = Date.now()
      expect(await ping(sql)).toBe(false)
      expect(Date.now() - start).toBeLessThan(5_000)
    } finally {
      await sql.end()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})

describe('checkHealth', () => {
  it('is unconfigured when no HYPERDRIVE binding is set', async () => {
    const config: Pick<Config, 'HYPERDRIVE'> = {}
    expect(await checkHealth(config, ctx)).toBe('unconfigured')
  })

  it(
    'is down without hanging when HYPERDRIVE points to a host that never completes the connection',
    async () => {
      const server = createServer((socket) => socket.on('data', () => {}))
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      const { port } = server.address() as { port: number }
      const config: Pick<Config, 'HYPERDRIVE'> = { HYPERDRIVE: { connectionString: `postgres://u:p@127.0.0.1:${port}/db` } }
      try {
        const start = Date.now()
        expect(await checkHealth(config, ctx)).toBe('down')
        expect(Date.now() - start).toBeLessThan(10_000)
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()))
      }
    },
    10_000,
  )

  it(
    'is ok past the old 5s cap when the connection is fine but the query response is delayed in transit',
    async () => {
      // Delays the query response past connect/statement timeouts; terminates TLS only if the
      // client sent an SSLRequest, else relays plainly (local dev's non-TLS Postgres).
      const SSL_REQUEST = Buffer.from([0, 0, 0, 8, 4, 210, 22, 47]) // length 8, code 80877103
      // Just past PING_TIMEOUT_MS (the old cap), leaving most of the 10s CHECK_HEALTH_TIMEOUT_MS
      // margin free for CI overhead (connect, TLS handshake) instead of the old 4s of slack.
      const STALL_MS = 5_200
      const target = new URL(DATABASE_URL)
      const queryMarker = Buffer.from('select 1')

      // Buffers all upstream replies after the query starts; flushing only the first would reorder the wire protocol.
      const relayWithStall = (clientSide: net.Socket, upstreamSide: net.Socket) => {
        let queryStarted = false
        let stalled = false
        let flushed = false
        const pending: Buffer[] = []
        clientSide.on('data', (chunk: Buffer) => {
          if (!queryStarted && chunk.includes(queryMarker)) queryStarted = true
          upstreamSide.write(chunk)
        })
        upstreamSide.on('data', (chunk: Buffer) => {
          if (!queryStarted || flushed) {
            clientSide.write(chunk)
            return
          }
          pending.push(chunk)
          if (!stalled) {
            stalled = true
            setTimeout(() => {
              flushed = true
              for (const buffered of pending) clientSide.write(buffered)
              pending.length = 0
            }, STALL_MS)
          }
        })
        clientSide.on('error', () => {})
        upstreamSide.on('error', () => {})
      }

      // Generated lazily, only once the upstream has confirmed TLS (reply 'S') — the plain
      // local-Postgres path below never calls this, so it never needs openssl on PATH.
      let certDir: string | undefined
      const getCert = async () => {
        try {
          execFileSync('openssl', ['version'], { stdio: 'ignore' })
        } catch {
          throw new Error('This test requires an `openssl` binary on PATH to generate a throwaway TLS cert for the sslmode path.')
        }
        certDir = await mkdtemp(path.join(os.tmpdir(), 'health-test-cert-'))
        const keyPath = path.join(certDir, 'key.pem')
        const certPath = path.join(certDir, 'cert.pem')
        execFileSync('openssl', [
          'req',
          '-x509',
          '-newkey',
          'rsa:2048',
          '-keyout',
          keyPath,
          '-out',
          certPath,
          '-days',
          '1',
          '-nodes',
          '-subj',
          '/CN=localhost',
        ])
        return Promise.all([readFile(keyPath), readFile(certPath)])
      }

      let tlsSetupError: Error | undefined
      try {
        const proxy = createServer((client) => {
          client.once('data', (first: Buffer) => {
            const isSslRequest = first.length === 8 && Buffer.compare(first, SSL_REQUEST) === 0
            const upstreamRaw = net.connect(Number(target.port) || 5432, target.hostname)
            upstreamRaw.once('connect', () => {
              upstreamRaw.write(first)
              if (!isSslRequest) {
                relayWithStall(client, upstreamRaw)
                return
              }
              upstreamRaw.once('data', (upstreamReply: Buffer) => {
                if (upstreamReply.length !== 1 || upstreamReply[0] !== 0x53) {
                  client.write(upstreamReply)
                  relayWithStall(client, upstreamRaw)
                  return
                }
                client.write('S')
                getCert()
                  .then(([key, cert]) => {
                    const clientTls = new tls.TLSSocket(client, { isServer: true, key, cert })
                    const upstreamTls = tls.connect({ socket: upstreamRaw, servername: target.hostname })
                    relayWithStall(clientTls, upstreamTls)
                  })
                  .catch((err: Error) => {
                    tlsSetupError = err
                    client.destroy()
                  })
              })
            })
            upstreamRaw.on('error', () => {})
          })
          client.on('error', () => {})
        })
        await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve))
        const { port } = proxy.address() as { port: number }
        const config: Pick<Config, 'HYPERDRIVE'> = {
          HYPERDRIVE: {
            connectionString: `postgres://${target.username}:${target.password}@127.0.0.1:${port}${target.pathname}${target.search}`,
          },
        }
        try {
          const start = Date.now()
          const status = await checkHealth(config, ctx)
          if (tlsSetupError) throw tlsSetupError
          const elapsed = Date.now() - start
          expect(status).toBe('ok')
          expect(elapsed).toBeGreaterThan(5_000)
          expect(elapsed).toBeLessThan(10_000)
        } finally {
          await new Promise<void>((resolve) => proxy.close(() => resolve()))
        }
      } finally {
        if (certDir) await rm(certDir, { recursive: true, force: true })
      }
    },
    12_000,
  )
})
