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

const tenantTables = [
  'partner', 'store', 'seller', 'customer', 'activity_log', 'outbox',
  'partner_user', 'partner_invitation', 'partner_domain', 'partner_setup_item', 'plan',
  'custom_domain', 'user', 'membership', 'invitation', 'job', 'store_note',
]

const dataModule = /^(postgres|#db\/client|\.{1,2}\/client)$/

/**
 * Whether a file can open a connection. Read whole, not line by line: a formatter may wrap an
 * import across lines, and a re-export or a dynamic import opens one just as well.
 */
export const opensAConnection = (source: string): boolean => {
  const names = (pattern: RegExp, group: number) =>
    [...source.matchAll(pattern)].some((match) => dataModule.test(match[group] ?? ''))
  // `import type` erases at compile time; every other spelling survives it.
  const typeOnly = /(?:^|[\n;])\s*(?:import|export)(\s+type\b)?[^'"]*?\bfrom\s*['"]([^'"]+)['"]/g
  const opensByName = [...source.matchAll(typeOnly)].some(
    (match) => match[1] === undefined && dataModule.test(match[2] ?? ''),
  )
  return (
    opensByName ||
    names(/\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g, 1) ||
    names(/(?:^|[\n;])\s*import\s*['"]([^'"]+)['"]/g, 1)
  )
}

describe('the data boundary', () => {
  it('lets nothing outside db/ open a database connection', () => {
    // `index.ts` is the composition root and may import anything (api/README.md §4); a
    // type-only import opens nothing.
    const offenders = filesUnder(srcDir)
      .filter((file) => !relative(file).startsWith('db/') && relative(file) !== 'index.ts')
      .filter((file) => opensAConnection(readFileSync(file, 'utf8')))
      .map(relative)
    expect(offenders).toEqual([])
  })

  it('catches a value import however it is spelled', () => {
    // #12's rule is only as good as this predicate, so the shapes that would slip past a
    // line-by-line check are asserted here rather than assumed.
    const opens = [
      "import postgres from 'postgres'",
      "import {\n  default as postgres,\n} from 'postgres'",
      "import { getClient } from './client'",
      "export { getClient } from '#db/client'",
      "const p = await import('postgres')",
      "import 'postgres'",
    ]
    for (const source of opens) expect([source, opensAConnection(source)]).toEqual([source, true])

    const inert = [
      "import type postgres from 'postgres'",
      "import type { Sql } from 'postgres'",
      "import { z } from 'zod'",
      "import type { ScopedSql } from '#db/scoped/index'",
    ]
    for (const source of inert) expect([source, opensAConnection(source)]).toEqual([source, false])
  })

  it('names a tenant table only inside db/', () => {
    // A query is written as a tagged template, so a bare table name in SQL shows up as
    // `from <table>`, `into <table>` or `update <table>`. Anything outside db/ doing that has
    // gone round the scoped layer.
    // `"user"` is quoted in SQL, so the name may carry quotes and the boundary after it is not a word one.
    const pattern = new RegExp(`\\b(from|into|update|join)\\s+"?(${tenantTables.join('|')})"?(?!\\w)`, 'i')
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
