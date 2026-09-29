import type postgres from 'postgres'
import { describe, expect, it, vi } from 'vitest'
import { ping } from './health'

describe('ping', () => {
  it('is healthy when the query succeeds', async () => {
    const sql = vi.fn().mockResolvedValue([{ '?column?': 1 }]) as unknown as postgres.Sql
    expect(await ping(sql)).toBe(true)
  })

  it('is unhealthy when the query fails', async () => {
    const sql = vi.fn().mockRejectedValue(new Error('connection refused')) as unknown as postgres.Sql
    expect(await ping(sql)).toBe(false)
  })
})
