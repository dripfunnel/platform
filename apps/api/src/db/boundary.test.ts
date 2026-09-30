import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// ACCESS.md §11.2: "Only `db/scoped` reads or writes tenant tables; raw table access is
// importable only there (lint plus test)." The lint rule enforces the layers; this enforces
// the narrower rule inside them, which no layer rule can express.

const srcDir = fileURLToPath(new URL('..', import.meta.url))

const filesUnder = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) return filesUnder(full)
    return full.endsWith('.ts') && !full.endsWith('.test.ts') ? [full] : []
  })

const relative = (file: string) => path.relative(srcDir, file)

const tenantTables = ['partner', 'store', 'seller', 'customer']

describe('the data boundary', () => {
  it('lets nothing outside db/ open a database connection', () => {
    const offenders = filesUnder(srcDir)
      .filter((file) => !relative(file).startsWith('db/'))
      .filter((file) => /from '(postgres|#db\/client|\.{1,2}\/client)'/.test(readFileSync(file, 'utf8')))
      .map(relative)
    expect(offenders).toEqual([])
  })

  it('names a tenant table only inside db/', () => {
    // A query is written as a tagged template, so a bare table name in SQL shows up as
    // `from <table>`, `into <table>` or `update <table>`. Anything outside db/ doing that has
    // gone round the scoped layer.
    const pattern = new RegExp(`\\b(from|into|update|join)\\s+(${tenantTables.join('|')})\\b`, 'i')
    const offenders = filesUnder(srcDir)
      .filter((file) => !relative(file).startsWith('db/'))
      .filter((file) => pattern.test(readFileSync(file, 'utf8')))
      .map(relative)
    expect(offenders).toEqual([])
  })

  it('touches the row-level security settings in exactly two files', () => {
    // db/rls/settings.ts decides the values from the caller's context and db/scoped applies
    // them (DATA-MODEL.md §5.1). A third file could choose a scope of its own.
    const allowed = [path.join('db', 'rls', 'settings.ts'), path.join('db', 'scoped', 'index.ts')]
    const offenders = filesUnder(srcDir)
      .filter((file) => !allowed.includes(relative(file)))
      .filter((file) => /set_config\(|set\s+local\s+app\./i.test(readFileSync(file, 'utf8')))
      .map(relative)
    expect(offenders).toEqual([])
  })
})
