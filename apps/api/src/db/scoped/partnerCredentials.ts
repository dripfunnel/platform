import type { SmsProvider, SmsRoute } from '#core/sms'
import type { AiProvider, PartnerCredentialRow, PartnerSmsAccountRow, PartnerWhatsAppAccountRow } from '../schema/saas'
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

// A partner's own SMS accounts (#1017): one row per provider, the secret sealed in key_enc and read in system scope only.
const smsColumns = `id, provider, key_prefix, status, last_tested_at, settings`

export const selectSmsAccounts = (tx: ScopedSql, partnerId: string): Promise<PartnerSmsAccountRow[]> =>
  tx<PartnerSmsAccountRow[]>`select ${tx.unsafe(smsColumns)} from partner_credential where partner_id = ${partnerId} and kind = 'sms' order by provider`

export const selectSmsAccount = async (tx: ScopedSql, partnerId: string, provider: SmsProvider): Promise<PartnerSmsAccountRow | null> =>
  (await tx<PartnerSmsAccountRow[]>`select ${tx.unsafe(smsColumns)} from partner_credential where partner_id = ${partnerId} and kind = 'sms' and provider = ${provider} for update`)[0] ?? null

export interface SmsAccountWrite {
  keyEnc: string
  keyPrefix: string
  settings: Record<string, unknown>
  status: 'untested' | 'ok'
  testedAt: Date | null
  at: Date
}

export const insertSmsAccount = async (tx: ScopedSql, input: SmsAccountWrite & { partnerId: string; provider: SmsProvider; name: string; createdBy: string }): Promise<string> =>
  (
    await tx<{ id: string }[]>`
      insert into partner_credential (partner_id, kind, provider, name, key_enc, key_prefix, settings, status, last_tested_at, created_by, created_at, updated_at)
      values (${input.partnerId}, 'sms', ${input.provider}, ${input.name}, ${input.keyEnc}, ${input.keyPrefix}, ${JSON.stringify(input.settings)}::text::jsonb, ${input.status}, ${input.testedAt}, ${input.createdBy}, ${input.at}, ${input.at})
      returning id`
  )[0]?.id ?? ''

export const updateSmsAccount = async (tx: ScopedSql, id: string, input: SmsAccountWrite): Promise<void> => {
  await tx`
    update partner_credential set key_enc = ${input.keyEnc}, key_prefix = ${input.keyPrefix}, settings = ${JSON.stringify(input.settings)}::text::jsonb,
      status = ${input.status}, last_tested_at = ${input.testedAt}, updated_at = ${input.at}
    where id = ${id} and kind = 'sms'`
}

export const updateSmsAccountTest = async (tx: ScopedSql, id: string, status: 'ok' | 'rejected', at: Date): Promise<void> => {
  await tx`update partner_credential set status = ${status}, last_tested_at = ${at}, last_validated_at = ${at}, last_validation_status = ${status}, updated_at = ${at} where id = ${id} and kind = 'sms'`
}

export const deleteSmsAccount = async (tx: ScopedSql, id: string): Promise<void> => {
  await tx`delete from partner_credential where id = ${id} and kind = 'sms'`
}

/** System scope only: one provider's account with its sealed secret, for the deliverer and a test. */
export const selectSealedSmsAccount = async (tx: ScopedSql, partnerId: string, provider: SmsProvider): Promise<{ key_enc: string; settings: unknown } | null> =>
  (await tx<{ key_enc: string; settings: unknown }[]>`select key_enc, settings from partner_credential where partner_id = ${partnerId} and kind = 'sms' and provider = ${provider}`)[0] ?? null

/** System scope only: every one of the partner's accounts with its sealed secret, for the deliverer. */
export const selectSealedSmsAccounts = (tx: ScopedSql, partnerId: string): Promise<{ provider: SmsProvider; key_enc: string; settings: unknown }[]> =>
  tx<{ provider: SmsProvider; key_enc: string; settings: unknown }[]>`select provider, key_enc, settings from partner_credential where partner_id = ${partnerId} and kind = 'sms'`

/** A route's provider, or DripFunnel's account where Admin enabled it for the partner (#1543). */
export type SmsRouteChoice = SmsProvider | 'dripfunnel'

export interface SmsPrefs {
  enabled: boolean
  /** The partner's choice for each route; null leaves it to the accounts it holds (THIRD-PARTY-ACCESS §4). */
  routes: Record<SmsRoute, SmsRouteChoice | null>
}

/** Whether the partner's stores may be texted at all, and its routes; a partner not found reads as on, with no choice. */
export const selectSmsPrefs = async (tx: ScopedSql, partnerId: string): Promise<SmsPrefs> => {
  const row = (await tx<{ sms_enabled: boolean; sms_route_india: SmsRouteChoice | null; sms_route_rest: SmsRouteChoice | null }[]>`select sms_enabled, sms_route_india, sms_route_rest from partner where id = ${partnerId}`)[0]
  return { enabled: row?.sms_enabled ?? true, routes: { india: row?.sms_route_india ?? null, rest: row?.sms_route_rest ?? null } }
}

export const updateSmsEnabled = async (tx: ScopedSql, partnerId: string, enabled: boolean): Promise<void> => {
  await tx`update partner set sms_enabled = ${enabled} where id = ${partnerId}`
}

export const updateSmsRoute = async (tx: ScopedSql, partnerId: string, route: SmsRoute, provider: SmsRouteChoice | null): Promise<void> => {
  if (route === 'india') await tx`update partner set sms_route_india = ${provider} where id = ${partnerId}`
  else await tx`update partner set sms_route_rest = ${provider} where id = ${partnerId}`
}

// A partner's own WhatsApp Business account on Meta (#1504): one row, the token sealed in key_enc and read in system scope only.
const whatsappColumns = `id, key_prefix, status, last_tested_at, settings`

export const selectWhatsAppAccount = async (tx: ScopedSql, partnerId: string): Promise<PartnerWhatsAppAccountRow | null> =>
  (await tx<PartnerWhatsAppAccountRow[]>`select ${tx.unsafe(whatsappColumns)} from partner_credential where partner_id = ${partnerId} and kind = 'whatsapp' and provider = 'meta' for update`)[0] ?? null

export const insertWhatsAppAccount = async (tx: ScopedSql, input: SmsAccountWrite & { partnerId: string; createdBy: string }): Promise<string> =>
  (
    await tx<{ id: string }[]>`
      insert into partner_credential (partner_id, kind, provider, name, key_enc, key_prefix, settings, status, last_tested_at, created_by, created_at, updated_at)
      values (${input.partnerId}, 'whatsapp', 'meta', 'WhatsApp', ${input.keyEnc}, ${input.keyPrefix}, ${JSON.stringify(input.settings)}::text::jsonb, ${input.status}, ${input.testedAt}, ${input.createdBy}, ${input.at}, ${input.at})
      returning id`
  )[0]?.id ?? ''

export const updateWhatsAppAccount = async (tx: ScopedSql, id: string, input: SmsAccountWrite): Promise<void> => {
  await tx`
    update partner_credential set key_enc = ${input.keyEnc}, key_prefix = ${input.keyPrefix}, settings = ${JSON.stringify(input.settings)}::text::jsonb,
      status = ${input.status}, last_tested_at = ${input.testedAt}, updated_at = ${input.at}
    where id = ${id} and kind = 'whatsapp'`
}

export const updateWhatsAppAccountTest = async (tx: ScopedSql, id: string, status: 'ok' | 'rejected', at: Date): Promise<void> => {
  await tx`update partner_credential set status = ${status}, last_tested_at = ${at}, last_validated_at = ${at}, last_validation_status = ${status}, updated_at = ${at} where id = ${id} and kind = 'whatsapp'`
}

export const deleteWhatsAppAccount = async (tx: ScopedSql, id: string): Promise<void> => {
  await tx`delete from partner_credential where id = ${id} and kind = 'whatsapp'`
}

/** System scope only: the account with its sealed token, and whether the partner's WhatsApp is on. */
export const selectSealedWhatsAppAccount = async (tx: ScopedSql, partnerId: string): Promise<{ key_enc: string; settings: unknown; enabled: boolean } | null> =>
  (
    await tx<{ key_enc: string; settings: unknown; enabled: boolean }[]>`
      select c.key_enc, c.settings, p.whatsapp_enabled as enabled from partner_credential c join partner p on p.id = c.partner_id
      where c.partner_id = ${partnerId} and c.kind = 'whatsapp' and c.provider = 'meta'`
  )[0] ?? null

/** A partner not found reads as off, as a new partner's WhatsApp is. */
export const selectWhatsAppEnabled = async (tx: ScopedSql, partnerId: string): Promise<boolean> =>
  (await tx<{ whatsapp_enabled: boolean }[]>`select whatsapp_enabled from partner where id = ${partnerId}`)[0]?.whatsapp_enabled ?? false

export type WhatsAppChoice = 'own' | 'dripfunnel'

/** Whose account sends the partner's WhatsApp, as it chose (#1543); null leaves it to its own, if it has one. */
export const selectWhatsAppChoice = async (tx: ScopedSql, partnerId: string): Promise<WhatsAppChoice | null> =>
  (await tx<{ whatsapp_account: WhatsAppChoice | null }[]>`select whatsapp_account from partner where id = ${partnerId}`)[0]?.whatsapp_account ?? null

export const updateWhatsAppChoice = async (tx: ScopedSql, partnerId: string, choice: WhatsAppChoice): Promise<void> => {
  await tx`update partner set whatsapp_account = ${choice} where id = ${partnerId}`
}

export interface WhatsAppState {
  enabled: boolean
  choice: WhatsAppChoice | null
  /** The partner's own account, its token still sealed. */
  own: { key_enc: string; settings: unknown; status: PartnerWhatsAppAccountRow['status'] } | null
}

/** System scope only: the partner's switch, its choice and its own account, in one read; a partner not found reads as off. */
export const selectWhatsAppState = async (tx: ScopedSql, partnerId: string): Promise<WhatsAppState> => {
  const row = (
    await tx<{ enabled: boolean; choice: WhatsAppChoice | null; key_enc: string | null; settings: unknown; status: PartnerWhatsAppAccountRow['status'] | null }[]>`
      select p.whatsapp_enabled as enabled, p.whatsapp_account as choice, c.key_enc, c.settings, c.status
      from partner p left join partner_credential c on c.partner_id = p.id and c.kind = 'whatsapp' and c.provider = 'meta'
      where p.id = ${partnerId}`
  )[0]
  if (!row) return { enabled: false, choice: null, own: null }
  return { enabled: row.enabled, choice: row.choice, own: row.key_enc !== null && row.status !== null ? { key_enc: row.key_enc, settings: row.settings, status: row.status } : null }
}

export const updateWhatsAppEnabled = async (tx: ScopedSql, partnerId: string, enabled: boolean): Promise<void> => {
  await tx`update partner set whatsapp_enabled = ${enabled} where id = ${partnerId}`
}
