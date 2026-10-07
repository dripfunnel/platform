import type postgres from 'postgres'
import type { ActivityLog, RequestFacts } from '#auth/activity'
import type { TenantContext } from '#core/tenancy'
import { withScope } from '#db/scoped/index'
import { countAccounts, saveCustomerAuth, selectCustomerAuth, type AccountCountsRow } from '#db/scoped/shopper'

// Settings › Customer accounts (SetAccess; ACCESS §2.1): how a store's shoppers sign in. Dropping mobile sign-in never
// locks anyone out: phone-only shoppers are asked for an email at their next sign-in (ACCESS §2.1, confirm).

export const customerAccountsAudit = { saved: 'store.customer_accounts_saved' } as const

export type SignInMode = 'email' | 'mobile' | 'both'

export interface CustomerAccountsView extends AccountCountsRow {
  mode: SignInMode
}

export interface CustomerAccountsDeps {
  sql: postgres.Sql
  context: TenantContext
  actor: { id: string; partnerId: string }
  activity: ActivityLog
  facts: RequestFacts
  now: () => Date
}

const modeOf = (auth: { email_enabled: boolean; phone_enabled: boolean }): SignInMode => (auth.email_enabled && auth.phone_enabled ? 'both' : auth.phone_enabled ? 'mobile' : 'email')

export const createCustomerAccounts = ({ sql, context, actor, activity, facts, now }: CustomerAccountsDeps) => {
  const { storeId } = context

  const settings = (): Promise<CustomerAccountsView> =>
    withScope(sql, context, async (tx) => ({ mode: modeOf(await selectCustomerAuth(tx, storeId)), ...(await countAccounts(tx, storeId)) }))

  const save = (mode: string): Promise<CustomerAccountsView | null> => {
    if (mode !== 'email' && mode !== 'mobile' && mode !== 'both') return Promise.resolve(null)
    return withScope(sql, context, async (tx) => {
      await saveCustomerAuth(tx, storeId, { email: mode !== 'mobile', phone: mode !== 'email' }, now())
      await activity.record(tx, {
        category: 'write',
        action: customerAccountsAudit.saved,
        result: 'success',
        actorKind: 'person',
        actorId: actor.id,
        actorLabel: null,
        partnerId: actor.partnerId,
        storeId,
        target: { type: 'store', id: storeId, label: 'Customer accounts' },
        reason: mode,
        api: 'store',
        visibility: 'store',
        ...facts,
      })
      return { mode, ...(await countAccounts(tx, storeId)) }
    })
  }

  return { settings, save }
}
