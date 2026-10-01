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
      // Delays only the query response (detected by its literal text) so connect_timeout and
      // statement_timeout can't catch it — only CHECK_HEALTH_TIMEOUT_MS can.
      //
      // DATABASE_URL is Neon in CI (requires TLS, sslmode=require), so a plain byte-for-byte TCP
      // relay doesn't work here: the 'select 1' marker below would be inside the encrypted TLS
      // stream and never match. Also, postgres.js skips SNI entirely for an IP host
      // (connection.js: `net.isIP(socket.host) ? undefined : socket.host`), and this proxy is
      // '127.0.0.1' — so a raw relay reaches Neon's edge with no SNI at all and gets rejected
      // before any query runs. So this proxy terminates TLS on both legs instead: a throwaway
      // self-signed cert for the client leg (postgres.js doesn't verify the cert under
      // sslmode=require — connection.js sets rejectUnauthorized: false for 'require'/'allow'/
      // 'prefer'), and a real TLS connection upstream with the correct servername. That leaves
      // plaintext Postgres protocol in the middle, where the marker match and stall below works.
      const STALL_MS = 6_000
      const target = new URL(DATABASE_URL)
      const queryMarker = Buffer.from('select 1')

      const certDir = await mkdtemp(path.join(os.tmpdir(), 'health-test-cert-'))
      const keyPath = path.join(certDir, 'key.pem')
      const certPath = path.join(certDir, 'cert.pem')
      try {
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
        const [key, cert] = await Promise.all([readFile(keyPath), readFile(certPath)])

        const proxy = createServer((client) => {
          client.once('data', (sslRequest: Buffer) => {
            client.write('S')
            const clientTls = new tls.TLSSocket(client, { isServer: true, key, cert })

            const upstreamRaw = net.connect(Number(target.port) || 5432, target.hostname)
            upstreamRaw.once('connect', () => {
              upstreamRaw.write(sslRequest)
              upstreamRaw.once('data', () => {
                const upstreamTls = tls.connect({ socket: upstreamRaw, servername: target.hostname })

                let queryStarted = false
                let stalled = false
                let flushed = false
                const pending: Buffer[] = []
                clientTls.on('data', (chunk: Buffer) => {
                  if (!queryStarted && chunk.includes(queryMarker)) queryStarted = true
                  upstreamTls.write(chunk)
                })
                upstreamTls.on('data', (chunk: Buffer) => {
                  // Buffer every read of the query response and flush in order; releasing only
                  // the first reorders the wire protocol.
                  if (!queryStarted || flushed) {
                    clientTls.write(chunk)
                    return
                  }
                  pending.push(chunk)
                  if (!stalled) {
                    stalled = true
                    setTimeout(() => {
                      flushed = true
                      for (const buffered of pending) clientTls.write(buffered)
                      pending.length = 0
                    }, STALL_MS)
                  }
                })
                clientTls.on('error', () => {})
                upstreamTls.on('error', () => {})
              })
            })
            upstreamRaw.on('error', () => {})
          })
          client.on('error', () => {})
        })
        await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve))
        const { port } = proxy.address() as { port: number }
        const config: Pick<Config, 'HYPERDRIVE'> = {
          HYPERDRIVE: { connectionString: `postgres://${target.username}:${target.password}@127.0.0.1:${port}${target.pathname}` },
        }
        try {
          const start = Date.now()
          const status = await checkHealth(config, ctx)
          const elapsed = Date.now() - start
          expect(status).toBe('ok')
          expect(elapsed).toBeGreaterThan(5_500)
          expect(elapsed).toBeLessThan(10_000)
        } finally {
          await new Promise<void>((resolve) => proxy.close(() => resolve()))
        }
      } finally {
        await rm(certDir, { recursive: true, force: true })
      }
    },
    12_000,
  )
})
