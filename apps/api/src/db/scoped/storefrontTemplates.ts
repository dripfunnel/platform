import type { ScopedSql } from './index'

// The template catalogue as staff read it (admin CONSOLE-DESIGN L4, DATA-MODEL §7.8): every template, offered or retired,
// the categories that start from it (§7.2), the stores whose storefront was made from it, and its demo store (0416).

export interface StaffTemplateRow {
  key: string
  name: string
  tag: string
  description: string
  state: 'offered' | 'retired'
  categories: { id: string; key: string; names: Record<string, string> }[]
  store_count: number
  demo_store_id: string | null
  /** The demo's preview files are in place. */
  demo_ready: boolean
}

/** The gallery's order (storefront ARCHITECTURE §2.3), retired ones last; the table holds a handful of rows. */
export const selectTemplatesForStaff = (tx: ScopedSql): Promise<StaffTemplateRow[]> =>
  tx<StaffTemplateRow[]>`
    select t.key, t.name, t.tag, t.description, t.state,
      coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'key', c.key, 'names', c.names) order by c.position, c.id)
        from store_category c where c.template_key = t.key and c.archived_at is null), '[]'::jsonb) as categories,
      coalesce(f.n, 0) as store_count,
      t.demo_store_id, exists (select 1 from design_draft d where d.store_id = t.demo_store_id and d.preview_deploy_ref is not null) as demo_ready
    from storefront_template t
    left join (select template, count(*)::int as n from storefront where template is not null group by template) f on f.template = t.key
    order by t.state = 'retired', t.key = 'classic' desc, t.key = 'baseline' desc, t.key
    limit 100`

export interface TemplateDemoRow {
  name: string
  demo_store_id: string | null
  /** The demo's Owner, whom its preview link is issued to (PREVIEW §5). */
  owner_id: string | null
  /** Set once the demo's preview files are in place. */
  preview_ref: string | null
}

/** A template and, when it has one, its demo store's Owner and preview, in one read. */
export const selectTemplateDemo = async (tx: ScopedSql, key: string): Promise<TemplateDemoRow | null> =>
  (
    await tx<TemplateDemoRow[]>`
      select t.name, t.demo_store_id, m.user_id as owner_id, d.preview_deploy_ref as preview_ref
      from storefront_template t
      left join lateral (select user_id from membership where store_id = t.demo_store_id and seller_id is null and role_key = 'owner' and status = 'active'
        order by created_at limit 1) m on true
      left join design_draft d on d.store_id = t.demo_store_id
      where t.key = ${key}`
  )[0] ?? null
