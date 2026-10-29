import type { AiProvider } from '../schema/saas'
import type { ScopedSql } from './index'

// Health of an AI connection: a store's account or a partner's key profile (migration 0373). System scope only. Every statement is
// held to the owner named in the ref, so one tenant's helper can never touch another's row.
export type ConnectionRef = { kind: 'store'; storeId: string } | { kind: 'partner'; partnerId: string; credentialId: string }
export type ValidationStatus = 'ok' | 'rejected' | 'unavailable'

export interface ConnectionRow {
  provider: AiProvider
  auth_type: 'api_key' | 'oauth'
  status: 'untested' | 'ok' | 'rejected'
  key_enc: string
  cooldown_until: Date | null
  cooldown_models: Record<string, string>
  last_validated_at: Date | null
  last_validation_status: ValidationStatus | null
  preferred_model: string | null
  fallback_authorized: boolean
}

export const selectConnection = async (tx: ScopedSql, ref: ConnectionRef): Promise<ConnectionRow | null> =>
  ref.kind === 'store'
    ? ((await tx<ConnectionRow[]>`
        select provider, auth_type, status, key_enc, cooldown_until, cooldown_models, last_validated_at, last_validation_status, preferred_model, fallback_authorized
        from store_ai_account where store_id = ${ref.storeId}`)[0] ?? null)
    : ((await tx<ConnectionRow[]>`
        select provider, auth_type, status, key_enc, cooldown_until, cooldown_models, last_validated_at, last_validation_status, preferred_model, false as fallback_authorized
        from partner_credential where id = ${ref.credentialId} and partner_id = ${ref.partnerId} and kind = 'ai'`)[0] ?? null)

/** A rejection also marks the account rejected, as a failed test does; an outage leaves its status alone. */
export const recordValidation = async (tx: ScopedSql, ref: ConnectionRef, result: ValidationStatus, at: Date): Promise<void> => {
  const status = result === 'unavailable' ? null : result
  if (ref.kind === 'store')
    await tx`update store_ai_account set last_validated_at = ${at}, last_validation_status = ${result}, status = coalesce(${status}, status), last_tested_at = case when ${status}::text is null then last_tested_at else ${at}::timestamptz end where store_id = ${ref.storeId}`
  else
    await tx`update partner_credential set last_validated_at = ${at}, last_validation_status = ${result}, status = coalesce(${status}, status), last_tested_at = case when ${status}::text is null then last_tested_at else ${at}::timestamptz end where id = ${ref.credentialId} and partner_id = ${ref.partnerId}`
}

/** Never shortens a cooldown that already runs longer: a second 429 can't cut the first one's wait. With a model, only that model waits. */
export const setCooldown = async (tx: ScopedSql, ref: ConnectionRef, until: Date, model?: string): Promise<void> => {
  if (model) {
    if (ref.kind === 'store')
      await tx`update store_ai_account set cooldown_models = cooldown_models || jsonb_build_object(${model}::text, greatest(coalesce((cooldown_models ->> ${model})::timestamptz, ${until}::timestamptz), ${until}::timestamptz)) where store_id = ${ref.storeId}`
    else
      await tx`update partner_credential set cooldown_models = cooldown_models || jsonb_build_object(${model}::text, greatest(coalesce((cooldown_models ->> ${model})::timestamptz, ${until}::timestamptz), ${until}::timestamptz)) where id = ${ref.credentialId} and partner_id = ${ref.partnerId}`
  } else if (ref.kind === 'store') await tx`update store_ai_account set cooldown_until = greatest(coalesce(cooldown_until, ${until}), ${until}) where store_id = ${ref.storeId}`
  else await tx`update partner_credential set cooldown_until = greatest(coalesce(cooldown_until, ${until}), ${until}) where id = ${ref.credentialId} and partner_id = ${ref.partnerId}`
}

export const clearCooldown = async (tx: ScopedSql, ref: ConnectionRef): Promise<void> => {
  if (ref.kind === 'store') await tx`update store_ai_account set cooldown_until = null, cooldown_models = '{}'::jsonb where store_id = ${ref.storeId}`
  else await tx`update partner_credential set cooldown_until = null, cooldown_models = '{}'::jsonb where id = ${ref.credentialId} and partner_id = ${ref.partnerId}`
}

export const setPreferredModel = async (tx: ScopedSql, ref: ConnectionRef, model: string | null): Promise<void> => {
  if (ref.kind === 'store') await tx`update store_ai_account set preferred_model = ${model} where store_id = ${ref.storeId}`
  else await tx`update partner_credential set preferred_model = ${model} where id = ${ref.credentialId} and partner_id = ${ref.partnerId}`
}
