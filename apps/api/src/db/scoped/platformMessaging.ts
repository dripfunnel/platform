import type { SmsProvider, SmsRoute } from '#core/sms'
import type { ScopedSql } from './index'

// DripFunnel's own SMS and WhatsApp accounts (#1543, migration 0410): system scope only, every column, as the Admin API
// reads and writes them for staff. A partner reads only its own two switches on `partner`.

export type MessagingKind = 'sms' | 'whatsapp' | 'maps'
export type OurProvider = SmsProvider | 'meta' | 'google'

export interface OurAccountRow {
  id: string
  provider: OurProvider
  key_enc: string
  key_prefix: string
  status: 'untested' | 'ok' | 'rejected'
  last_tested_at: Date | null
  settings: unknown
}

const columns = `id, provider, key_enc, key_prefix, status, last_tested_at, settings`

export const selectOurAccounts = (tx: ScopedSql, kind: MessagingKind): Promise<OurAccountRow[]> =>
  tx<OurAccountRow[]>`select ${tx.unsafe(columns)} from platform_credential where kind = ${kind} order by provider`

export const selectOurAccount = async (tx: ScopedSql, kind: MessagingKind, provider: OurProvider): Promise<OurAccountRow | null> =>
  (await tx<OurAccountRow[]>`select ${tx.unsafe(columns)} from platform_credential where kind = ${kind} and provider = ${provider} for update`)[0] ?? null

export interface OurAccountWrite {
  keyEnc: string
  keyPrefix: string
  settings: Record<string, unknown>
  testedAt: Date
  createdBy: string
}

/** Saving replaces the provider's one account: a save is checked first, so it is always `ok`. */
export const upsertOurAccount = async (tx: ScopedSql, kind: MessagingKind, provider: OurProvider, w: OurAccountWrite): Promise<void> => {
  await tx`
    insert into platform_credential (kind, provider, key_enc, key_prefix, settings, status, last_tested_at, created_by, created_at, updated_at)
    values (${kind}, ${provider}, ${w.keyEnc}, ${w.keyPrefix}, ${JSON.stringify(w.settings)}::text::jsonb, 'ok', ${w.testedAt}, ${w.createdBy}, ${w.testedAt}, ${w.testedAt})
    on conflict (kind, provider) do update set key_enc = excluded.key_enc, key_prefix = excluded.key_prefix, settings = excluded.settings,
      status = 'ok', last_tested_at = excluded.last_tested_at, updated_at = excluded.updated_at`
}

export const updateOurAccountTest = async (tx: ScopedSql, id: string, status: 'ok' | 'rejected', at: Date): Promise<void> => {
  await tx`update platform_credential set status = ${status}, last_tested_at = ${at}, updated_at = ${at} where id = ${id}`
}

export const deleteOurAccount = async (tx: ScopedSql, id: string): Promise<void> => {
  await tx`delete from platform_credential where id = ${id}`
}

export interface OurMessaging {
  /** DripFunnel's provider per route; null leaves it to the route's first provider it holds an account for. */
  routes: Record<SmsRoute, SmsProvider | null>
  whatsappEnabled: boolean
  mapsEnabled: boolean
}

export const selectOurMessaging = async (tx: ScopedSql): Promise<OurMessaging> => {
  const row = (await tx<{ sms_route_india: SmsProvider | null; sms_route_rest: SmsProvider | null; whatsapp_enabled: boolean; maps_enabled: boolean }[]>`select sms_route_india, sms_route_rest, whatsapp_enabled, maps_enabled from platform_messaging`)[0]
  return { routes: { india: row?.sms_route_india ?? null, rest: row?.sms_route_rest ?? null }, whatsappEnabled: row?.whatsapp_enabled ?? false, mapsEnabled: row?.maps_enabled ?? false }
}

export const updateOurSmsRoute = async (tx: ScopedSql, route: SmsRoute, provider: SmsProvider | null, at: Date): Promise<void> => {
  if (route === 'india') await tx`update platform_messaging set sms_route_india = ${provider}, updated_at = ${at}`
  else await tx`update platform_messaging set sms_route_rest = ${provider}, updated_at = ${at}`
}

export const updateOurMapsEnabled = async (tx: ScopedSql, enabled: boolean, at: Date): Promise<void> => {
  await tx`update platform_messaging set maps_enabled = ${enabled}, updated_at = ${at}`
}

export const updateOurWhatsAppEnabled = async (tx: ScopedSql, enabled: boolean, at: Date): Promise<void> => {
  await tx`update platform_messaging set whatsapp_enabled = ${enabled}, updated_at = ${at}`
}

/** Admin's switches for one partner; a partner not found reads as all off. */
export const selectDfMessaging = async (tx: ScopedSql, partnerId: string): Promise<Record<MessagingKind, boolean>> => {
  const row = (await tx<{ df_sms_enabled: boolean; df_whatsapp_enabled: boolean; df_maps_enabled: boolean }[]>`select df_sms_enabled, df_whatsapp_enabled, df_maps_enabled from partner where id = ${partnerId}`)[0]
  return { sms: row?.df_sms_enabled ?? false, whatsapp: row?.df_whatsapp_enabled ?? false, maps: row?.df_maps_enabled ?? false }
}

export const updateDfMessaging = async (tx: ScopedSql, partnerId: string, kind: MessagingKind, enabled: boolean): Promise<void> => {
  if (kind === 'sms') await tx`update partner set df_sms_enabled = ${enabled} where id = ${partnerId}`
  else if (kind === 'whatsapp') await tx`update partner set df_whatsapp_enabled = ${enabled} where id = ${partnerId}`
  else await tx`update partner set df_maps_enabled = ${enabled} where id = ${partnerId}`
}

export const selectPartnerName = async (tx: ScopedSql, partnerId: string): Promise<string | null> =>
  (await tx<{ name: string }[]>`select name from partner where id = ${partnerId}`)[0]?.name ?? null
