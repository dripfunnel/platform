import postgres from 'postgres'
import { afterAll, describe, expect, it } from 'vitest'
import { assertExtensionsAvailable, requiredExtensions } from './extensions'

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://dripfunnel_dev:dripfunnel_dev@localhost:5432/dripfunnel'
const sql = postgres(DATABASE_URL, { max: 1 })

afterAll(async () => {
  await sql.end()
})

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
    await expect(assertExtensionsAvailable(sql, [])).resolves.toBeUndefined()
  })

  it('throws naming a missing extension and how to install it', async () => {
    await expect(assertExtensionsAvailable(sql, ['not_a_real_extension'])).rejects.toThrow(/not_a_real_extension/)
  })

  it('passes when the required extension is available', async () => {
    await expect(assertExtensionsAvailable(sql, ['plpgsql'])).resolves.toBeUndefined()
  })
})
