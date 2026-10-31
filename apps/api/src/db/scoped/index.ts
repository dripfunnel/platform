import type postgres from 'postgres'
import type { CallerContext } from '#core/tenancy'
import { roleFor, settingsFor } from '../rls/settings'

export type ScopedSql = postgres.TransactionSql

/** No list query returns more than this however it is asked (AGENTS.md "Reliability"); each API caps lower. */
export const maxPageSize = 100

export const pageLimit = (limit: number): number => Math.min(Math.max(Math.floor(limit), 1), maxPageSize)

/** The only path to tenant data (api/README.md §4). One transaction, because `SET LOCAL`
 *  lives only that long; the caller kind's role, because a superuser bypasses RLS (DATA-MODEL §5.3). */
export const withScope = async <T>(
  sql: postgres.Sql,
  context: CallerContext,
  work: (tx: ScopedSql) => Promise<T>,
): Promise<T> =>
  sql.begin(async (tx) => {
    // The role and every setting in one statement, each a parameter (#478): `set_config('role', …, true)` is
    // `SET LOCAL ROLE`, membership check included, and a refusal aborts the transaction before the work.
    const settings = [['role', roleFor(context)], ...Object.entries(settingsFor(context))]
    await tx`
      select set_config(name, value, true)
      from unnest(${pgArray(settings.map(([name]) => name))}::text[], ${pgArray(settings.map(([, value]) => value))}::text[]) as setting(name, value)
    `
    return work(tx)
  }) as Promise<T>

/** Jobs, webhooks and sign-in: granted per table through `app_system` (DATA-MODEL.md §5.2). */
export const withSystemScope = async <T>(sql: postgres.Sql, work: (tx: ScopedSql) => Promise<T>): Promise<T> =>
  sql.begin(async (tx) => {
    await tx`set local role app_system`
    await tx`select set_config('app.scope', 'system', true)`
    return work(tx)
  }) as Promise<T>

// A Postgres array literal for `= any(${pgArray(values)}::uuid[])`: the Worker's client cannot
// send a JavaScript array (docs/api/README.md §7).
export const pgArray = (values: readonly string[]): string => `{${values.map((v) => `"${v.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`).join(',')}}`


/** Holds `key` to the end of the transaction, so a count-then-insert under a limit can't race (AGENTS.md "Reliability"). */
export const serialise = async (tx: ScopedSql, key: string): Promise<void> => {
  await tx`select pg_advisory_xact_lock(hashtext(${key}))`
}

/** A unique constraint's refusal, by name, so a caller can answer it as the clash it is. */
export const uniqueViolation = (error: unknown, constraint: string): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === '23505' && 'constraint_name' in error && error.constraint_name === constraint
