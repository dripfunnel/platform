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
    // A role is an identifier, never a parameter; roleFor returns only the literals it names.
    await tx.unsafe(`set local role ${roleFor(context)}`)
    for (const [name, value] of Object.entries(settingsFor(context))) {
      await tx`select set_config(${name}, ${value}, true)`
    }
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

