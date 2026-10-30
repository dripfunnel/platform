import type { AiProvider, PartnerCredentialRow } from '../schema/saas'
import type { ScopedSql } from './index'

// A partner's AI key profiles (#275). The sealed key is written here and read only in system scope (selectDefaultKey).
const columns = `id, partner_id, kind, provider, name, is_default, key_prefix, status, last_tested_at, auth_type, account_label, created_by, created_at`

export const selectAiProfiles = (tx: ScopedSql, partnerId: string): Promise<PartnerCredentialRow[]> =>
  tx<PartnerCredentialRow[]>`select ${tx.unsafe(columns)} from partner_credential where partner_id = ${partnerId} and kind = 'ai' order by created_at`

export const selectAiProfile = async (tx: ScopedSql, partnerId: string, id: string): Promise<PartnerCredentialRow | null> =>
  (await tx<PartnerCredentialRow[]>`select ${tx.unsafe(columns)} from partner_credential where id = ${id} and partner_id = ${partnerId} and kind = 'ai' for update`)[0] ?? null

export const insertAiProfile = async (
  tx: ScopedSql,
  input: { partnerId: string; provider: AiProvider; name: string; keyEnc: string; keyPrefix: string; status: 'untested' | 'ok'; testedAt: Date | null; isDefault: boolean; createdBy: string; authType?: 'api_key' | 'oauth'; accountLabel?: string | null },
): Promise<string> =>
  (
    await tx<{ id: string }[]>`
      insert into partner_credential (partner_id, kind, provider, name, key_enc, key_prefix, status, last_tested_at, is_default, created_by, auth_type, account_label)
      values (${input.partnerId}, 'ai', ${input.provider}, ${input.name}, ${input.keyEnc}, ${input.keyPrefix}, ${input.status}, ${input.testedAt}, ${input.isDefault}, ${input.createdBy}, ${input.authType ?? 'api_key'}, ${input.accountLabel ?? null})
      returning id`
  )[0]?.id ?? ''

export const updateAiProfileTest = async (tx: ScopedSql, id: string, status: 'ok' | 'rejected', at: Date): Promise<void> => {
  await tx`update partner_credential set status = ${status}, last_tested_at = ${at}, last_validated_at = ${at}, last_validation_status = ${status}, updated_at = ${at} where id = ${id}`
}

export const setDefaultAiProfile = async (tx: ScopedSql, partnerId: string, id: string, at: Date): Promise<void> => {
  await tx`update partner_credential set is_default = false, updated_at = ${at} where partner_id = ${partnerId} and kind = 'ai' and is_default and id <> ${id}`
  await tx`update partner_credential set is_default = true, updated_at = ${at} where id = ${id}`
}

export const deleteAiProfile = async (tx: ScopedSql, id: string): Promise<void> => {
  await tx`delete from partner_credential where id = ${id}`
}

/** The oldest remaining profile, promoted when the default is removed. */
export const firstAiProfileId = async (tx: ScopedSql, partnerId: string): Promise<string | null> =>
  (await tx<{ id: string }[]>`select id from partner_credential where partner_id = ${partnerId} and kind = 'ai' order by created_at limit 1`)[0]?.id ?? null

/** System scope only: the sealed default key and its provider, for the model call. */
export const selectDefaultAiKey = async (tx: ScopedSql, partnerId: string): Promise<{ id: string; provider: AiProvider; key_enc: string; status: PartnerCredentialRow['status']; auth_type: PartnerCredentialRow['auth_type'] } | null> =>
  (await tx<{ id: string; provider: AiProvider; key_enc: string; status: PartnerCredentialRow['status']; auth_type: PartnerCredentialRow['auth_type'] }[]>`select id, provider, key_enc, status, auth_type from partner_credential where partner_id = ${partnerId} and kind = 'ai' and is_default`)[0] ?? null

/** System scope only: one profile's sealed key, held to its partner, for a test. */
export const selectSealedAiKey = async (tx: ScopedSql, partnerId: string, id: string): Promise<{ provider: AiProvider; key_enc: string; auth_type: PartnerCredentialRow['auth_type'] } | null> =>
  (await tx<{ provider: AiProvider; key_enc: string; auth_type: PartnerCredentialRow['auth_type'] }[]>`select provider, key_enc, auth_type from partner_credential where id = ${id} and partner_id = ${partnerId} and kind = 'ai'`)[0] ?? null
