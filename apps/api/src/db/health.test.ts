/// <reference types="node" />
import { createServer } from 'node:net'
import net from 'node:net'
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
      // Proxies to the real Postgres, forwarding everything untouched until it sees the
      // ReadyForQuery ('Z') that marks the connection as up, then holds the *next* chunk (the
      // select-1 response) for STALL_MS before forwarding it. That delay is pure network
      // transit time: it trips neither connect_timeout (connection already established) nor
      // statement_timeout (the query itself runs instantly on the server). Only
      // CHECK_HEALTH_TIMEOUT_MS can catch it, so this fails against the old 5s cap and passes
      // against the current 10s one.
      const STALL_MS = 6_000
      const target = new URL(DATABASE_URL)
      let readySeen = false
      const proxy = createServer((client) => {
        const upstream = net.connect(Number(target.port) || 5432, target.hostname)
        client.pipe(upstream)
        upstream.on('data', (chunk: Buffer) => {
          if (!readySeen) {
            if (chunk.includes(0x5a)) readySeen = true
            client.write(chunk)
            return
          }
          readySeen = false
          setTimeout(() => client.write(chunk), STALL_MS)
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
