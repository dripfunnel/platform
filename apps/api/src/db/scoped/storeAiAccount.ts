import type { AiProvider } from '../schema/saas'
import type { ScopedSql } from './index'

// A store's own AI account (#950; migration 0369). Metadata reads in store scope; the sealed key is system scope only.
export interface StoreAiAccountRow {
  store_id: string
  provider: AiProvider
  key_prefix: string
  status: 'untested' | 'ok' | 'rejected'
  last_tested_at: Date | null
  use_when_plan_used: boolean
  fallback_authorized: boolean
  auth_type: 'api_key' | 'oauth'
  account_label: string | null
  connected_by: string
  connected_at: Date
}

const columns = `store_id, provider, key_prefix, status, last_tested_at, use_when_plan_used, fallback_authorized, auth_type, account_label, connected_by, connected_at`

export const selectStoreAiAccount = async (tx: ScopedSql, storeId: string): Promise<StoreAiAccountRow | null> =>
  (await tx<StoreAiAccountRow[]>`select ${tx.unsafe(columns)} from store_ai_account where store_id = ${storeId}`)[0] ?? null

/** System scope: the sealed key with its provider and the switch, for a model call. */
export const selectSealedStoreKey = async (tx: ScopedSql, storeId: string): Promise<{ provider: AiProvider; key_enc: string; status: StoreAiAccountRow['status']; use_when_plan_used: boolean; auth_type: StoreAiAccountRow['auth_type'] } | null> =>
  (await tx<{ provider: AiProvider; key_enc: string; status: StoreAiAccountRow['status']; use_when_plan_used: boolean; auth_type: StoreAiAccountRow['auth_type'] }[]>`select provider, key_enc, status, use_when_plan_used, auth_type from store_ai_account where store_id = ${storeId}`)[0] ?? null

export const upsertStoreAiAccount = async (tx: ScopedSql, a: { storeId: string; provider: AiProvider; keyEnc: string; keyPrefix: string; status: 'untested' | 'ok'; testedAt: Date | null; connectedBy: string; at: Date; authType?: 'api_key' | 'oauth'; accountLabel?: string | null }): Promise<void> => {
  await tx`
    insert into store_ai_account (store_id, provider, key_enc, key_prefix, status, last_tested_at, connected_by, connected_at, updated_at, auth_type, account_label)
    values (${a.storeId}, ${a.provider}, ${a.keyEnc}, ${a.keyPrefix}, ${a.status}, ${a.testedAt}, ${a.connectedBy}, ${a.at}, ${a.at}, ${a.authType ?? 'api_key'}, ${a.accountLabel ?? null})
    on conflict (store_id) do update set provider = excluded.provider, key_enc = excluded.key_enc, key_prefix = excluded.key_prefix, status = excluded.status,
      last_tested_at = excluded.last_tested_at, connected_by = excluded.connected_by, connected_at = excluded.connected_at, updated_at = excluded.updated_at, auth_type = excluded.auth_type, account_label = excluded.account_label,
      last_validated_at = null, last_validation_status = null, cooldown_until = null, cooldown_models = '{}'::jsonb, preferred_model = null, fallback_authorized = false`
}

export const updateStoreAiAccountTest = async (tx: ScopedSql, storeId: string, status: 'ok' | 'rejected', at: Date): Promise<void> => {
  await tx`update store_ai_account set status = ${status}, last_tested_at = ${at}, last_validated_at = ${at}, last_validation_status = ${status}, updated_at = ${at} where store_id = ${storeId}`
}

export const setStoreAiSwitch = async (tx: ScopedSql, storeId: string, on: boolean, at: Date): Promise<boolean> =>
  (await tx`update store_ai_account set use_when_plan_used = ${on}, updated_at = ${at} where store_id = ${storeId} returning 1`).length > 0

export const setStoreAiFallback = async (tx: ScopedSql, storeId: string, on: boolean, at: Date): Promise<boolean> =>
  (await tx`update store_ai_account set fallback_authorized = ${on}, updated_at = ${at} where store_id = ${storeId} returning 1`).length > 0

export const deleteStoreAiAccount = async (tx: ScopedSql, storeId: string): Promise<void> => {
  await tx`delete from store_ai_account where store_id = ${storeId}`
}
