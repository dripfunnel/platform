/// <reference types="node" />
import net, { createServer } from 'node:net'
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
      const STALL_MS = 6_000
      const target = new URL(DATABASE_URL)
      const queryMarker = Buffer.from('select 1')
      let queryStarted = false
      let stalled = false
      let flushed = false
      const proxy = createServer((client) => {
        const upstream = net.connect(Number(target.port) || 5432, target.hostname)
        const pending: Buffer[] = []
        client.on('data', (chunk: Buffer) => {
          if (!queryStarted && chunk.includes(queryMarker)) queryStarted = true
          upstream.write(chunk)
        })
        upstream.on('data', (chunk: Buffer) => {
          // Buffer every read of the query response and flush in order; releasing only the
          // first reorders the wire protocol.
          if (!queryStarted || flushed) {
            client.write(chunk)
            return
          }
          pending.push(chunk)
          if (!stalled) {
            stalled = true
            setTimeout(() => {
              flushed = true
              for (const buffered of pending) client.write(buffered)
              pending.length = 0
            }, STALL_MS)
          }
        })
        client.on('error', () => {})
        upstream.on('error', () => {})
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
    },
    12_000,
  )
})
