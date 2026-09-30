import type postgres from 'postgres'
import { REQUIRED_POSTGRES_MAJOR } from './version-check'

// Strips line/block comments only; a `create extension` mentioned inside a string literal or a
// $$ function body still matches and is reported as required, which is a false positive, not a
// missed one, so it fails safe.
const CREATE_EXTENSION_RE = /create\s+extension\s+(?:if\s+not\s+exists\s+)?"?([a-z0-9_]+)"?/gi
const SQL_COMMENT_RE = /--[^\n]*|\/\*[\s\S]*?\*\//g

const stripComments = (sql: string): string => sql.replace(SQL_COMMENT_RE, '')

export const requiredExtensions = (migrationSql: readonly string[]): string[] => {
  const names = new Set<string>()
  for (const sql of migrationSql) {
    for (const match of stripComments(sql).matchAll(CREATE_EXTENSION_RE)) {
      const name = match[1]
      if (name) names.add(name)
    }
  }
  return [...names]
}

export const assertExtensionsAvailable = async (sql: postgres.Sql, required: readonly string[]): Promise<void> => {
  if (required.length === 0) return
  const rows = await sql<{ name: string }[]>`select name from pg_available_extensions where name = any(${required})`
  const available = new Set(rows.map((row) => row.name))
  const missing = required.filter((name) => !available.has(name))
  if (missing.length > 0) {
    throw new Error(
      `Missing Postgres extension(s): ${missing.join(', ')}. Install the "postgresql-contrib" package ` +
        `(macOS Homebrew: brew install postgresql@${REQUIRED_POSTGRES_MAJOR}; Debian/Ubuntu: apt install postgresql-contrib-${REQUIRED_POSTGRES_MAJOR}; ` +
        `Windows: included with the postgresql.org installer) and restart Postgres, then re-run migrate.`,
    )
  }
}
