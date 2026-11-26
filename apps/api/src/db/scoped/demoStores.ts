import type { ScopedSql } from './index'

// A category template's demo store (DATA-MODEL §7.2, migration 0416), read and written in system scope only: staff and
// partners never see a demo store (its restrictive policy).

export interface DemoTemplateRow {
  key: string
  demo_store_id: string | null
  category_id: string | null
  /** The category's sample currency; null while the category has no sample. */
  currency: string | null
}

/** The offered template, locked, and the first live category that starts from it with its sample's currency. */
export const lockDemoTemplate = async (tx: ScopedSql, key: string): Promise<DemoTemplateRow | null> =>
  (
    await tx<DemoTemplateRow[]>`
      select t.key, t.demo_store_id, c.id as category_id, x.currency
      from storefront_template t
      left join lateral (select id from store_category where template_key = t.key and archived_at is null order by position, id limit 1) c on true
      left join store_category_sample x on x.category_id = c.id
      where t.key = ${key} and t.state = 'offered'
      for update of t`
  )[0] ?? null

export const selectHousePartner = async (tx: ScopedSql): Promise<{ id: string; country: string | null } | null> =>
  (await tx<{ id: string; country: string | null }[]>`select id, country from partner where is_house and state <> 'closed'`)[0] ?? null

export interface NewDemoStore {
  partnerId: string
  categoryId: string
  name: string
  code: string
  slug: string
  country: string | null
  pricingCurrency: string
  at: Date
}

export const insertDemoStore = async (tx: ScopedSql, s: NewDemoStore): Promise<string> => {
  const [row] = await tx<{ id: string }[]>`
    insert into store (partner_id, name, code, slug, country, pricing_currency, status, storefront_kind, category_id, is_demo, created_at)
    values (${s.partnerId}, ${s.name}, ${s.code}, ${s.slug}, ${s.country}, ${s.pricingCurrency}, 'active', 'ai', ${s.categoryId}, true, ${s.at})
    returning id`
  if (!row) throw new Error('store: insert returned no row')
  return row.id
}

/** The demo's Owner: a person with no password and an address no mail reaches, who exists so the sample import has one. */
export const insertDemoOwner = async (tx: ScopedSql, partnerId: string, storeId: string, email: string, name: string): Promise<string> => {
  const [user] = await tx<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${partnerId}, ${email}, ${name}, 'active') returning id`
  if (!user) throw new Error('user: insert returned no row')
  await tx`insert into membership (user_id, store_id, role_key, status) values (${user.id}, ${storeId}, 'owner', 'active')`
  return user.id
}

export const setTemplateDemo = async (tx: ScopedSql, key: string, storeId: string): Promise<void> => {
  await tx`update storefront_template set demo_store_id = ${storeId} where key = ${key}`
}

export interface DemoStoreRow {
  store_id: string
  partner_id: string
  owner_id: string
  category_id: string | null
  has_logo: boolean
  /** The preview's folder once the template's files are in it. */
  preview_ref: string | null
}

export const selectDemoStore = async (tx: ScopedSql, storeId: string): Promise<DemoStoreRow | null> =>
  (
    await tx<DemoStoreRow[]>`
      select s.id as store_id, s.partner_id, m.user_id as owner_id, s.category_id, s.logo_asset_id is not null as has_logo, d.preview_deploy_ref as preview_ref
      from store s
      join membership m on m.store_id = s.id and m.seller_id is null and m.role_key = 'owner' and m.status = 'active'
      left join design_draft d on d.store_id = s.id
      where s.id = ${storeId} and s.is_demo
      order by m.created_at limit 1`
  )[0] ?? null

/** The store's logo, and the brand step's logo and favicon, all one file. */
export const setDemoLogo = async (tx: ScopedSql, storeId: string, assetId: string): Promise<void> => {
  await tx`update store set logo_asset_id = ${assetId} where id = ${storeId} and is_demo`
  await tx`
    insert into storefront_brand (store_id, logo_asset_id, favicon_asset_id) values (${storeId}, ${assetId}, ${assetId})
    on conflict (store_id) do update set logo_asset_id = excluded.logo_asset_id, favicon_asset_id = excluded.favicon_asset_id`
}

/** The one rule for whether `storefront_template t`'s demo is served (PREVIEW.md §9): the demo host, its Shop API, admin's
 *  Preview and the gallery's demoUrl all ask it, so none promises a demo another refuses. */
export const demoServed = (tx: ScopedSql) => tx`(t.state = 'offered' and exists (
  select 1 from store s join partner p on p.id = s.partner_id join design_draft d on d.store_id = s.id
  where s.id = t.demo_store_id and s.is_demo and s.status <> 'closed' and p.state <> 'closed' and d.preview_deploy_ref is not null))`

/** The demo host's files for a template named by its key or its name, in lower case, a key first (PREVIEW.md §9). */
export const selectDemoSite = async (tx: ScopedSql, asked: string): Promise<{ key: string; store_id: string; folder: string } | null> =>
  (
    await tx<{ key: string; store_id: string; folder: string }[]>`
      select t.key, t.demo_store_id as store_id, d.preview_deploy_ref as folder
      from storefront_template t join design_draft d on d.store_id = t.demo_store_id
      where (t.key = ${asked} or lower(t.name) = ${asked}) and ${demoServed(tx)}
      order by t.key = ${asked} desc, t.key
      limit 1`
  )[0] ?? null

/** Whether the store is a template's demo; any scope that reads its own store row may ask. */
export const isDemoStore = async (tx: ScopedSql, storeId: string): Promise<boolean> =>
  (await tx<{ is_demo: boolean }[]>`select is_demo from store where id = ${storeId}`)[0]?.is_demo ?? false
