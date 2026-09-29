import type postgres from 'postgres'
import { describe, expect, it, vi } from 'vitest'
import { assertExtensionsAvailable, requiredExtensions } from './extensions'

describe('requiredExtensions', () => {
  it('extracts extension names from create extension statements', () => {
    expect(requiredExtensions(['create extension if not exists "pgcrypto";', 'create table t (id int);'])).toEqual(['pgcrypto'])
  })

  it('is empty when no migration declares an extension', () => {
    expect(requiredExtensions(['create table t (id int);'])).toEqual([])
  })

  it('ignores create extension inside line and block comments', () => {
    expect(
      requiredExtensions(['-- create extension postgis\ncreate table t (id int);', '/* create extension postgis */ create table u (id int);']),
    ).toEqual([])
  })
})

describe('assertExtensionsAvailable', () => {
  it('passes when nothing is required', async () => {
    const sql = vi.fn() as unknown as postgres.Sql
    await expect(assertExtensionsAvailable(sql, [])).resolves.toBeUndefined()
    expect(sql).not.toHaveBeenCalled()
  })

  it('throws naming a missing extension and how to install it', async () => {
    const sql = vi.fn().mockResolvedValue([]) as unknown as postgres.Sql
    await expect(assertExtensionsAvailable(sql, ['pgcrypto'])).rejects.toThrow(/pgcrypto/)
  })

  it('passes when the required extension is available', async () => {
    const sql = vi.fn().mockResolvedValue([{ name: 'pgcrypto' }]) as unknown as postgres.Sql
    await expect(assertExtensionsAvailable(sql, ['pgcrypto'])).resolves.toBeUndefined()
  })
})
