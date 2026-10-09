import type { ScopedSql } from './index'

// The partner's look and words (migrations/0016; DATA-MODEL.md §2.5).

export interface BrandingFields {
  product_name: string
  primary_color: string
  accent_color: string
  font: 'Nunito' | 'Source Sans 3' | 'Manrope' | 'Lora' | 'DM Sans'
  corner: 'rounded' | 'soft' | 'square'
  background: 'sand' | 'plain' | 'photo'
  logo_light_key: string | null
  logo_dark_key: string | null
  mark_key: string | null
  favicon_key: string | null
  app_icon_key: string | null
  app_icon_foreground_key: string | null
  splash_key: string | null
  support_email: string | null
  support_url: string | null
  help_url: string | null
  terms_url: string | null
  privacy_url: string | null
  dpa_url: string | null
  impressum: string | null
  powered_by: boolean
}

export interface BrandingRow extends BrandingFields {
  id: string
  partner_id: string
  state: 'draft' | 'published' | 'cancelled'
  created_by_label: string
  created_at: Date
  published_at: Date | null
  published_by_label: string | null
}

const fields = [
  'product_name', 'primary_color', 'accent_color', 'font', 'corner', 'background', 'logo_light_key', 'logo_dark_key', 'mark_key', 'favicon_key',
  'app_icon_key', 'app_icon_foreground_key', 'splash_key',
  'support_email', 'support_url', 'help_url', 'terms_url', 'privacy_url', 'dpa_url', 'impressum', 'powered_by',
] as const

/** The partner's live version (the newest published by the database's clock, the one publish stamps) and its draft. */
export const selectBranding = async (tx: ScopedSql, partnerId: string): Promise<{ live: BrandingRow | null; draft: BrandingRow | null }> => {
  const [live] = await tx<BrandingRow[]>`
    select * from partner_branding where partner_id = ${partnerId} and state = 'published' and published_at <= now()
    order by published_at desc, id desc limit 1
  `
  const [draft] = await tx<BrandingRow[]>`select * from partner_branding where partner_id = ${partnerId} and state = 'draft'`
  return { live: live ?? null, draft: draft ?? null }
}

/** A draft; or, for the seed and migrations of data alone, a version already published at `publishedAt` (0016's trigger). */
export const insertBranding = async (
  tx: ScopedSql,
  b: BrandingFields & { partnerId: string; by: { kind: 'partner_user' | 'staff' | 'system'; label: string } } & ({ state: 'draft' } | { state: 'published'; publishedAt: Date }),
): Promise<string> => {
  const row = {
    ...Object.fromEntries(fields.map((f) => [f, b[f]])),
    partner_id: b.partnerId,
    state: b.state,
    created_by_kind: b.by.kind,
    created_by_label: b.by.label,
    published_at: b.state === 'published' ? b.publishedAt : null,
    published_by_label: b.state === 'published' ? b.by.label : null,
  }
  const [inserted] = await tx<{ id: string }[]>`insert into partner_branding ${tx(row)} returning id`
  if (!inserted) throw new Error('partner_branding insert returned no row')
  return inserted.id
}

/** The partner's draft holds `b` afterwards: the existing one changed, or a new one added. Returns its id. */
export const saveBrandingDraft = async (tx: ScopedSql, partnerId: string, b: BrandingFields, by: { kind: 'partner_user' | 'staff'; label: string }): Promise<string> => {
  // Two first publishes at once would both find no draft and both insert one: they take turns.
  await tx`select pg_advisory_xact_lock(hashtext(${`partner_branding:${partnerId}`}))`
  const [draft] = await tx<{ id: string }[]>`select id from partner_branding where partner_id = ${partnerId} and state = 'draft' for update`
  if (!draft) return insertBranding(tx, { ...b, partnerId, state: 'draft', by })
  await tx`update partner_branding set ${tx(b, ...fields)} where id = ${draft.id}`
  return draft.id
}

/** Publishes a draft now, at the database's clock (0016's trigger refuses a back-dated one). */
export const publishBrandingDraft = async (tx: ScopedSql, id: string, label: string): Promise<Date> => {
  const [row] = await tx<{ published_at: Date }[]>`
    update partner_branding set state = 'published', published_at = date_trunc('milliseconds', now()), published_by_label = ${label}
    where id = ${id} and state = 'draft' returning published_at
  `
  if (!row) throw new Error('partner_branding: no draft to publish')
  return row.published_at
}

/** The partner row's look, which the admin console's lists read, kept equal to the live version (DATA-MODEL §2.5). */
export const mirrorPartnerLook = async (tx: ScopedSql, partnerId: string, b: Pick<BrandingFields, 'product_name' | 'primary_color' | 'accent_color' | 'powered_by'>): Promise<void> => {
  await tx`
    update partner set product_name = ${b.product_name}, primary_color = ${b.primary_color}, accent_color = ${b.accent_color},
      powered_by = case when powered_by = 'house' then 'house' when ${b.powered_by} then 'on' else 'off' end
    where id = ${partnerId}
  `
}
