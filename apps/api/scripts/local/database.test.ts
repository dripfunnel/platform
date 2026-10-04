import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { checkDatabase } from './database'

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://dripfunnel_dev:dripfunnel_dev@localhost:5432/dripfunnel'
const migrationsDir = fileURLToPath(new URL('../../migrations', import.meta.url))
const withDatabase = (name: string) => Object.assign(new URL(DATABASE_URL), { pathname: `/${name}` }).toString()

describe('checkDatabase', () => {
  it('accepts the local Postgres for setup', async () => {
    expect(await checkDatabase(DATABASE_URL, migrationsDir, 'setup')).toEqual([])
  })

  it('names the createdb command when the database is missing', async () => {
    const [finding] = await checkDatabase(withDatabase('dripfunnel_no_such_db'), migrationsDir, 'setup')
    expect(finding?.problem).toBe(`Postgres is running, but database "dripfunnel_no_such_db" doesn't exist.`)
    expect(finding?.fix).toMatch(/createdb -p \d+ -O .+ dripfunnel_no_such_db$/)
  })

  it('says Postgres is down when nothing listens on the port', async () => {
    const url = Object.assign(new URL(DATABASE_URL), { port: '1' }).toString()
    const [finding] = await checkDatabase(url, migrationsDir, 'setup')
    expect(finding?.problem).toBe("Postgres isn't answering on localhost:1.")
  })

  it('reports a migration the database has not applied', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'df-migrations-'))
    writeFileSync(path.join(dir, '9999_not_applied.sql'), '')
    const [finding] = await checkDatabase(DATABASE_URL, dir, 'full')
    expect(finding?.problem).toBe('1 migration(s) not applied, starting with 9999_not_applied.sql.')
  })
})
