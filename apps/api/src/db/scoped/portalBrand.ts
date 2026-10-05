import type { ScopedSql } from './index'

// The look and words a partner's portal host shows before anyone signs in (SAAS.md §3.3, §3.4;
// FIRST-RELEASE §4). `system` scope: the reader is anonymous, and only published fields leave.

export interface PortalBrandRow {
  partner_name: string
  product_name: string | null
  primary_color: string | null
  accent_color: string | null
  font: string | null
  corner: string | null
  background: string | null
  logo_light_key: string | null
  logo_dark_key: string | null
  mark_key: string | null
  favicon_key: string | null
  support_email: string | null
  support_url: string | null
  help_url: string | null
  terms_url: string | null
  privacy_url: string | null
  powered_by: boolean
}

/** The partner's live version: the newest published one whose time has come; the partner's name alone before any. */
export const selectPortalBrand = async (tx: ScopedSql, partnerId: string, now: Date): Promise<PortalBrandRow | null> => {
  const rows = await tx<PortalBrandRow[]>`
    select p.name as partner_name, b.product_name, b.primary_color, b.accent_color, b.font, b.corner, b.background,
      b.logo_light_key, b.logo_dark_key, b.mark_key, b.favicon_key,
      b.support_email, b.support_url, b.help_url, b.terms_url, b.privacy_url, coalesce(b.powered_by, true) as powered_by
    from partner p
    left join lateral (
      select * from partner_branding
      where partner_id = p.id and state = 'published' and published_at <= ${now}
      order by published_at desc, id desc limit 1
    ) b on true
    where p.id = ${partnerId}
  `
  return rows[0] ?? null
}
