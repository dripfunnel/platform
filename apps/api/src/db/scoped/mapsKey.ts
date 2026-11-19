import type { ScopedSql } from './index'
import type { MapsChoice } from './partnerCredentials'

// Everything that decides which Google Maps key a store's maps use (#1612), in one system-scope read: the partner's choice,
// its own key, DripFunnel's key, and DripFunnel's two switches (saas/mapsKey picks). Keys are still sealed here.

type KeyStatus = 'untested' | 'ok' | 'rejected'

export interface StoreMapsKeys {
  choice: MapsChoice | null
  /** DripFunnel's key, and whether Super admin turned it on and Admin let this partner use it. */
  ours: { keyEnc: string; status: KeyStatus; allowed: boolean } | null
  own: { keyEnc: string; status: KeyStatus } | null
}

/** System scope: whether DripFunnel's key is there for a partner, a Working one that Super admin and Admin both turned on. */
export const selectOurMapsUsable = async (tx: ScopedSql, partnerId: string): Promise<boolean> =>
  (
    await tx<{ usable: boolean }[]>`
      select (m.maps_enabled and p.df_maps_enabled and ours.status = 'ok') as usable
      from partner p
      cross join platform_messaging m
      join platform_credential ours on ours.kind = 'maps' and ours.provider = 'google'
      where p.id = ${partnerId}`
  )[0]?.usable ?? false

/** Null for a store that isn't there. */
export const selectStoreMapsKeys = async (tx: ScopedSql, storeId: string): Promise<StoreMapsKeys | null> => {
  const row = (
    await tx<{ choice: MapsChoice | null; df_maps_enabled: boolean; maps_enabled: boolean; own_enc: string | null; own_status: KeyStatus | null; ours_enc: string | null; ours_status: KeyStatus | null }[]>`
      select p.maps_account as choice, p.df_maps_enabled, m.maps_enabled, own.key_enc as own_enc, own.status as own_status, ours.key_enc as ours_enc, ours.status as ours_status
      from store s
      join partner p on p.id = s.partner_id
      cross join platform_messaging m
      left join partner_credential own on own.partner_id = p.id and own.kind = 'maps' and own.provider = 'google'
      left join platform_credential ours on ours.kind = 'maps' and ours.provider = 'google'
      where s.id = ${storeId}`
  )[0]
  if (!row) return null
  return {
    choice: row.choice,
    own: row.own_enc !== null && row.own_status !== null ? { keyEnc: row.own_enc, status: row.own_status } : null,
    ours: row.ours_enc !== null && row.ours_status !== null ? { keyEnc: row.ours_enc, status: row.ours_status, allowed: row.maps_enabled && row.df_maps_enabled } : null,
  }
}
