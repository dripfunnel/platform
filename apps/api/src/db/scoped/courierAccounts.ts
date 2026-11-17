import type { CourierProvider } from '#core/couriers'
import type { ScopedSql } from './index'

// A store's own courier login (migration 0409; THIRD-PARTY-ACCESS §4, #1489). The password and the tracking token arrive
// sealed by the caller (auth/secretBox); the store's scope never selects them back, only system scope does.

export interface CourierAccountRow {
  provider: CourierProvider
  email: string
}

/** The logins the store's own scope may see: who, never the secret. */
export const selectCourierAccounts = (tx: ScopedSql, storeId: string): Promise<CourierAccountRow[]> =>
  tx<CourierAccountRow[]>`select provider, email from courier_account where store_id = ${storeId} order by provider`

/** Connecting again replaces the login. Delete then insert, since an upsert would need to select the sealed value. */
export const saveCourierAccount = async (tx: ScopedSql, a: { storeId: string; provider: CourierProvider; email: string; sealed: string; by: string; at: Date }): Promise<void> => {
  await tx`delete from courier_account where store_id = ${a.storeId} and provider = ${a.provider}`
  await tx`
    insert into courier_account (store_id, provider, email, credentials_sealed, connected_by, connected_at)
    values (${a.storeId}, ${a.provider}, ${a.email}, ${a.sealed}, ${a.by}, ${a.at})
  `
}

export const deleteCourierAccount = async (tx: ScopedSql, storeId: string, provider: CourierProvider): Promise<boolean> =>
  (await tx`delete from courier_account where store_id = ${storeId} and provider = ${provider} returning store_id`).length === 1

/** System scope: the checkout, label and hook paths read the sealed login of the one store they act for. */
export const selectSealedCourierAccounts = (tx: ScopedSql, storeId: string): Promise<{ provider: CourierProvider; email: string; credentials_sealed: string }[]> =>
  tx<{ provider: CourierProvider; email: string; credentials_sealed: string }[]>`select provider, email, credentials_sealed from courier_account where store_id = ${storeId}`

/** System scope: the store a tracking hook names, and the partner it belongs to. */
export const selectStorePartner = async (tx: ScopedSql, storeId: string): Promise<string | null> =>
  (await tx<{ partner_id: string }[]>`select partner_id from store where id = ${storeId}`)[0]?.partner_id ?? null
