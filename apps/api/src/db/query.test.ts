import type postgres from 'postgres'
import { describe, expect, it, vi } from 'vitest'
import { query } from './query'

const fakeSql = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }))

describe('query', () => {
  it('forwards parameterised values to the underlying client', () => {
    const run = query(fakeSql as unknown as postgres.Sql)
    const id = 'seller_1'
    void run`select * from sellers where id = ${id}`
    expect(fakeSql).toHaveBeenCalledWith(expect.anything(), 'seller_1')
  })

  it('rejects bindings that are not safe primitive values', () => {
    const run = query(fakeSql as unknown as postgres.Sql)
    const unsafe = { $where: '1=1' }
    expect(() => run`select * from sellers where meta = ${unsafe as never}`).toThrow()
  })
})
