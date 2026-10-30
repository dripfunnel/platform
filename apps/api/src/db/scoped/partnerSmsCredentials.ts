import type { SmsProvider } from '#core/sms'
import type { PartnerSmsCredentialRow } from '../schema/saas'
import type { ScopedSql } from './index'

// A partner's own SMS accounts (#1017), `sms` rows of partner_credential. The sealed secret is written here and read only in
// system scope (selectSealedSmsAccount); settings hold what isn't secret.
const columns = `id, partner_id, provider, key_prefix, status, last_tested_at, settings, created_by, created_at`

const label: Record<SmsProvider, string> = { msg91: 'MSG91', twilio: 'Twilio' }

export const selectSmsAccounts = (tx: ScopedSql, partnerId: string): Promise<PartnerSmsCredentialRow[]> =>
  tx<PartnerSmsCredentialRow[]>`select ${tx.unsafe(columns)} from partner_credential where partner_id = ${partnerId} and kind = 'sms' order by provider`

export const selectSmsAccount = async (tx: ScopedSql, partnerId: string, provider: SmsProvider): Promise<PartnerSmsCredentialRow | null> =>
  (await tx<PartnerSmsCredentialRow[]>`select ${tx.unsafe(columns)} from partner_credential where partner_id = ${partnerId} and kind = 'sms' and provider = ${provider} for update`)[0] ?? null

export const insertSmsAccount = async (tx: ScopedSql, input: { partnerId: string; provider: SmsProvider; keyEnc: string; keyPrefix: string; settings: Record<string, unknown>; createdBy: string }): Promise<string> =>
  (
    await tx<{ id: string }[]>`
      insert into partner_credential (partner_id, kind, provider, name, key_enc, key_prefix, settings, created_by)
      values (${input.partnerId}, 'sms', ${input.provider}, ${label[input.provider]}, ${input.keyEnc}, ${input.keyPrefix}, ${tx.json(input.settings as Parameters<typeof tx.json>[0])}, ${input.createdBy})
      returning id`
  )[0]?.id ?? ''

export const updateSmsAccountTest = async (tx: ScopedSql, id: string, status: 'ok' | 'rejected', at: Date): Promise<void> => {
  await tx`update partner_credential set status = ${status}, last_tested_at = ${at}, updated_at = ${at} where id = ${id}`
}

export const deleteSmsAccount = async (tx: ScopedSql, id: string): Promise<void> => {
  await tx`delete from partner_credential where id = ${id}`
}

/** System scope only: one account's sealed secret and settings, held to its partner, for a send or a test. */
export const selectSealedSmsAccount = async (tx: ScopedSql, partnerId: string, provider: SmsProvider): Promise<{ id: string; key_enc: string; settings: Record<string, unknown> } | null> =>
  (await tx<{ id: string; key_enc: string; settings: Record<string, unknown> }[]>`select id, key_enc, settings from partner_credential where partner_id = ${partnerId} and kind = 'sms' and provider = ${provider}`)[0] ?? null
