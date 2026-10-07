import type { ScopedSql } from './index'

// Which store a storefront request is for (ARCHITECTURE §2; ACCESS §3): its host or its public store key, read in system
// scope before any tenant exists, as the portal's host is (storeCaller.ts).

export interface StorefrontRow {
  store_id: string
  partner_id: string
  status: 'trial' | 'active' | 'past_due' | 'suspended' | 'cancelled' | 'closed'
  catalog_version: string
  main_language: string
  country: string | null
  pricing_currency: string | null
  languages: string[]
  currencies: string[]
  markets: { id: string; currency: string; language: string | null }[]
  /** Settings › Catalogue's section switches the store has set (catalogListing.ts has the defaults). */
  features: Record<string, boolean>
  /** Reached on its partner's preview wildcard: checkout there is in each provider's test mode (storefront ARCHITECTURE §4.1). */
  preview: boolean
}

const storefrontColumns = (tx: ScopedSql) => tx`
  s.id as store_id, s.partner_id, s.status, f.catalog_version::text as catalog_version, s.main_language, s.country, s.pricing_currency::text as pricing_currency,
  coalesce((select json_agg(l.language order by l.position, l.language) from store_language l where l.store_id = s.id and l.status = 'active'), '[]'::json) as languages,
  coalesce((select json_agg(c.currency order by c.position, c.currency) from store_currency c where c.store_id = s.id and c.status = 'active'), '[]'::json) as currencies,
  coalesce((select json_agg(json_build_object('id', m.id, 'currency', m.currency, 'language', m.language)) from market m
    where m.store_id = s.id and m.deleted_at is null and m.status = 'active'), '[]'::json) as markets,
  coalesce((select json_object_agg(sf.key, sf.enabled) from store_feature sf where sf.store_id = s.id), '{}'::json) as features
`

/**
 * A store's own storefront host: `{code}.` under its partner's preview or shops wildcard, or its live custom domain.
 * A partner's wildcard is held as `*.shops.example.com` (partner_domain), live or on its way to it.
 */
export const selectStorefrontByHost = async (tx: ScopedSql, host: string): Promise<StorefrontRow | null> => {
  const name = host.toLowerCase()
  const dot = name.indexOf('.')
  const code = dot > 0 ? name.slice(0, dot) : ''
  const wildcard = dot > 0 ? `*${name.slice(dot)}` : ''
  const rows = await tx<StorefrontRow[]>`
    select ${storefrontColumns(tx)}, exists (
        select 1 from partner_domain d where d.partner_id = s.partner_id and d.kind = 'preview' and lower(d.host) = ${wildcard} and s.code = ${code}
      ) as preview
    from store s join storefront f on f.store_id = s.id
    where (
      s.code = ${code} and exists (
        select 1 from partner_domain d join partner p on p.id = d.partner_id
        where d.partner_id = s.partner_id and d.kind in ('preview', 'shops') and lower(d.host) = ${wildcard}
          and d.status not in ('waiting', 'failed') and p.state <> 'closed'
      )
    ) or exists (
      select 1 from custom_domain c join partner p on p.id = s.partner_id
      where c.store_id = s.id and lower(c.host) = ${name} and c.status in ('live', 'expiring') and p.state <> 'closed'
    )
    limit 2
  `
  // Two stores claiming one host is a data fault: neither is served.
  return rows.length === 1 ? (rows[0] ?? null) : null
}

export const selectStorefrontByKey = async (tx: ScopedSql, key: string): Promise<StorefrontRow | null> =>
  (
    await tx<StorefrontRow[]>`
      select ${storefrontColumns(tx)}, false as preview from store s join storefront f on f.store_id = s.id join partner p on p.id = s.partner_id
      where f.public_store_key = ${key} and p.state <> 'closed'
    `
  )[0] ?? null
