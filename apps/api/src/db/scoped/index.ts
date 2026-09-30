import type postgres from 'postgres'
import type { CallerContext } from '#core/tenancy'
import { settingsFor } from '../rls/settings'

export type ScopedSql = postgres.TransactionSql

/**
 * The only way tenant data is read or written (api/README.md §4, AGENTS.md "Tenancy and
 * access"). Everything it gives you runs inside one transaction with the caller's scope
 * applied, and `db/rls` refuses whatever a query forgets.
 *
 * Three things make it hold:
 *
 *  - **One transaction.** `SET LOCAL` lives only for the transaction, which is what makes
 *    it safe with Hyperdrive's pooled connections (DATA-MODEL.md §5.1).
 *  - **The settings come from the context**, never from request input, and are passed as
 *    query parameters through `set_config` rather than interpolated into SQL.
 *  - **The role is `app_request`**, which is not a superuser and so cannot bypass RLS.
 *    Production connects as it already; locally a developer's superuser connection would
 *    otherwise sail straight through every policy, and the backstop would only be tested
 *    in CI. Setting it here means local, CI and production all enforce the same rules.
 */
export const withScope = async <T>(
  sql: postgres.Sql,
  context: CallerContext,
  work: (tx: ScopedSql) => Promise<T>,
): Promise<T> =>
  sql.begin(async (tx) => {
    await tx`set local role app_request`
    for (const [name, value] of Object.entries(settingsFor(context))) {
      await tx`select set_config(${name}, ${value}, true)`
    }
    return work(tx)
  }) as Promise<T>

// `system` scope (jobs, webhooks, retention) is deliberately absent. DATA-MODEL §5.2 grants
// it "per job to the tables it needs, through a separate database role", and no policy here
// has a system branch — so a `withSystemScope` written now would connect as `app_system` and
// silently return nothing, which is worse than not having it. #15 adds it with the branch it
// needs, and the isolation matrix should grow a case proving jobs see only their own tables.
