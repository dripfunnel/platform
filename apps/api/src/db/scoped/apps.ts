import type { PageWindow } from '#core/paging'
import { pgArray, type ScopedSql } from './index'

// Private apps and their grants (DATA-MODEL §7.10, migrations/0152): the registry in platform scope (staff), a store's
// installs in its own scope, and a presented grant token resolved in system scope.

export interface AppRow {
  id: string
  name: string
  developer: string
  site_url: string
  scopes: string[]
  status: 'live' | 'suspended'
}

export interface AppAdminRow extends AppRow {
  webhook_url: string
  created_at: Date
}

const keyset = (tx: ScopedSql, window: PageWindow, column: string) => tx`
  ${window.after ? tx`(${tx(column)}, id) < (${window.after.occurredAt}, ${window.after.id})` : tx`true`}
  and ${window.before ? tx`(${tx(column)}, id) > (${window.before.occurredAt}, ${window.before.id})` : tx`true`}`
const ordered = (tx: ScopedSql, window: PageWindow, column: string) => {
  const dir = window.before && !window.after ? tx`asc` : tx`desc`
  return tx`order by ${tx(column)} ${dir}, id ${dir} limit ${window.limit + 1}`
}

export const selectAppsForStaff = (tx: ScopedSql, window: PageWindow): Promise<AppAdminRow[]> =>
  tx<AppAdminRow[]>`
    select id, name, developer, site_url, webhook_url, to_jsonb(scopes) as scopes, status, created_at from app
    where ${keyset(tx, window, 'created_at')} ${ordered(tx, window, 'created_at')}
  `

export const insertApp = async (tx: ScopedSql, a: { id: string; name: string; developer: string; siteUrl: string; webhookUrl: string; scopes: readonly string[]; secretSealed: string; by: string; now: Date }): Promise<void> => {
  await tx`
    insert into app (id, name, developer, site_url, webhook_url, scopes, secret_sealed, created_by_staff_id, created_at, updated_at)
    values (${a.id}, ${a.name}, ${a.developer}, ${a.siteUrl}, ${a.webhookUrl}, ${pgArray(a.scopes)}::text[], ${a.secretSealed}, ${a.by}, ${a.now}, ${a.now})
  `
}

export const setAppStatus = async (tx: ScopedSql, id: string, status: 'live' | 'suspended', now: Date): Promise<{ name: string; before: string } | null> =>
  (
    await tx<{ name: string; before: string }[]>`
      update app a set status = ${status}, updated_at = ${now} from (select id, status as before from app where id = ${id} for update) old
      where a.id = old.id returning a.name, old.before
    `
  )[0] ?? null

/** A live app as a store's consent screen reads it. */
export const selectLiveApp = async (tx: ScopedSql, id: string): Promise<AppRow | null> =>
  (await tx<AppRow[]>`select id, name, developer, site_url, to_jsonb(scopes) as scopes, status from app where id = ${id} and status = 'live'`)[0] ?? null

export interface GrantRow {
  id: string
  app_id: string
  app_name: string
  developer: string
  site_url: string
  app_status: 'live' | 'suspended'
  scopes: string[]
  installed_by_name: string | null
  installed_at: Date
  last_used_at: Date | null
}

export const selectGrants = (tx: ScopedSql, storeId: string, window: PageWindow): Promise<GrantRow[]> =>
  tx<GrantRow[]>`
    select g.id, g.app_id, a.name as app_name, a.developer, a.site_url, a.status as app_status, to_jsonb(g.scopes) as scopes, u.name as installed_by_name,
      g.installed_at, g.last_used_at
    from app_grant g join app a on a.id = g.app_id left join "user" u on u.id = g.installed_by_user_id
    where g.store_id = ${storeId} and g.revoked_at is null
      and ${window.after ? tx`(g.installed_at, g.id) < (${window.after.occurredAt}, ${window.after.id})` : tx`true`}
      and ${window.before ? tx`(g.installed_at, g.id) > (${window.before.occurredAt}, ${window.before.id})` : tx`true`}
    order by g.installed_at ${window.before && !window.after ? tx`asc` : tx`desc`}, g.id ${window.before && !window.after ? tx`asc` : tx`desc`}
    limit ${window.limit + 1}
  `

/** False when the app is already installed here: the live-install index refused the second. */
export const insertGrant = async (tx: ScopedSql, g: { id: string; storeId: string; appId: string; scopes: readonly string[]; tokenHash: string; by: string; now: Date }): Promise<boolean> => {
  try {
    await tx.savepoint((sp) => sp`
      insert into app_grant (id, store_id, app_id, scopes, token_hash, installed_by_user_id, installed_at)
      values (${g.id}, ${g.storeId}, ${g.appId}, ${pgArray(g.scopes)}::text[], ${g.tokenHash}, ${g.by}, ${g.now})
    `)
    return true
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'constraint_name' in error && error.constraint_name === 'app_grant_live_key') return false
    throw error
  }
}

export const lockLiveGrant = async (tx: ScopedSql, storeId: string, id: string): Promise<{ id: string; app_id: string; app_name: string } | null> =>
  (
    await tx<{ id: string; app_id: string; app_name: string }[]>`
      select g.id, g.app_id, a.name as app_name from app_grant g join app a on a.id = g.app_id
      where g.id = ${id} and g.store_id = ${storeId} and g.revoked_at is null for update of g
    `
  )[0] ?? null

export const revokeGrant = async (tx: ScopedSql, id: string, by: string, now: Date): Promise<void> => {
  await tx`update app_grant set revoked_at = ${now}, revoked_by_user_id = ${by} where id = ${id} and revoked_at is null`
}

export interface PresentedGrantRow {
  id: string
  app_id: string
  app_name: string
  store_id: string
  partner_id: string
  store_name: string
  store_status: 'trial' | 'active' | 'past_due' | 'suspended' | 'cancelled'
  scopes: string[]
}

/** A live grant of a live app, on a live store of the host's partner; anything else reads as no grant. */
export const selectPresentedGrant = async (tx: ScopedSql, hash: string, partnerId: string): Promise<PresentedGrantRow | null> =>
  (
    await tx<PresentedGrantRow[]>`
      select g.id, g.app_id, a.name as app_name, g.store_id, s.partner_id, s.name as store_name, s.status as store_status, to_jsonb(g.scopes) as scopes
      from app_grant g join app a on a.id = g.app_id join store s on s.id = g.store_id
      where g.token_hash = ${hash} and g.revoked_at is null and a.status = 'live' and s.partner_id = ${partnerId} and s.status <> 'closed'
    `
  )[0] ?? null

export const touchGrant = async (tx: ScopedSql, id: string, now: Date): Promise<void> => {
  await tx`update app_grant set last_used_at = ${now} where id = ${id} and (last_used_at is null or last_used_at < ${new Date(now.getTime() - 60_000)})`
}

export interface AppNoticeRow {
  revoked: boolean
  webhook_url: string
  secret_sealed: string
  status: 'live' | 'suspended'
  store_name: string
  partner_id: string
}

/** What the relay needs to tell an app about a grant: its address and secret, and the store's name. */
export const selectAppNotice = async (tx: ScopedSql, grantId: string): Promise<AppNoticeRow | null> =>
  (
    await tx<AppNoticeRow[]>`
      select g.revoked_at is not null as revoked, a.webhook_url, a.secret_sealed, a.status, s.name as store_name, s.partner_id
      from app_grant g join app a on a.id = g.app_id join store s on s.id = g.store_id where g.id = ${grantId}
    `
  )[0] ?? null
