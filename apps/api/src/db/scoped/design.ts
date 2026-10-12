import { maxPageSize, type ScopedSql } from './index'
import { storefrontHostOf } from './publishing'

// The Storefront area's rows as the Store API reads and the studio writes them (DATA-MODEL §7.8): the template gallery
// (platform data, read in system scope), the chat, and the store's design state. Every read names the context's store.

export interface TemplateRow {
  key: string
  name: string
  tag: string
  description: string
  /** The demo store's live address, when it has one. */
  demo_host: string | null
}

/** The gallery in a fixed order, "Start from scratch" first, as ST 0 lists it (storefront ARCHITECTURE §2.3); one page of at most `maxPageSize`. */
export const selectOfferedTemplates = (tx: ScopedSql): Promise<TemplateRow[]> =>
  tx<TemplateRow[]>`
    select t.key, t.name, t.tag, t.description, case when s.id is null then null else ${storefrontHostOf(tx)} end as demo_host
    from storefront_template t left join store s on s.id = t.demo_store_id
    where t.state = 'offered'
    order by t.key = 'baseline' desc, case t.key when 'linen' then 1 when 'concrete' then 2 when 'bloom' then 3 when 'circuit' then 4
      when 'market' then 5 when 'atelier' then 6 else 7 end, t.key
    limit ${maxPageSize}`

export const isOfferedTemplate = async (tx: ScopedSql, key: string): Promise<boolean> =>
  (await tx`select 1 from storefront_template where key = ${key} and state = 'offered'`).length > 0

export type MessageRole = 'note'

export interface NewMessage {
  storeId: string
  role: MessageRole
  text: string
  createdBy: string | null
  at: Date
}

export const insertDesignMessage = async (tx: ScopedSql, m: NewMessage): Promise<string> => {
  const [row] = await tx<{ id: string }[]>`
    insert into design_message (store_id, role, text, created_by, created_at)
    values (${m.storeId}, ${m.role}, ${m.text}, ${m.createdBy}, ${m.at})
    returning id`
  if (!row) throw new Error('design_message: insert returned nothing')
  return row.id
}

export interface DesignStateRow {
  repo_state: 'none' | 'creating' | 'ready' | 'failed'
  storefront_template: string | null
  live_build_id: string | null
  live_number: number | null
  live_published_at: Date | null
  live_template: string | null
  draft_template: string | null
  draft_head: string | null
  draft_changed_at: Date | null
  draft_preview: string | null
}

/** Where the store's design stands: its repo, its live version and its draft (FIRST-RELEASE §14's status line). */
export const selectDesignState = async (tx: ScopedSql, storeId: string): Promise<DesignStateRow | null> =>
  (
    await tx<DesignStateRow[]>`
      select f.repo_state, f.template as storefront_template, f.live_build_id, v.number as live_number, v.published_at as live_published_at,
        v.template as live_template, d.template as draft_template, d.head_commit as draft_head, d.changed_at as draft_changed_at,
        d.preview_deploy_ref as draft_preview
      from storefront f
        left join design_version v on v.store_id = f.store_id and v.state = 'live'
        left join design_draft d on d.store_id = f.store_id
      where f.store_id = ${storeId}`
  )[0] ?? null

export interface VersionHistoryRow {
  id: string
  number: number
  template: string
  core_version: string
  label: string | null
  state: 'live' | 'kept'
  published_at: Date
}

/** The history the plan keeps (SAAS §9.2): the live version always, the others published since `since`; newest first, a page at a time. */
export const selectVersionHistory = (tx: ScopedSql, storeId: string, since: Date, before: number | null, limit: number): Promise<VersionHistoryRow[]> =>
  tx<VersionHistoryRow[]>`
    select id, number, template, core_version, label, state, published_at from design_version
    where store_id = ${storeId} and (state = 'live' or published_at >= ${since}) ${before === null ? tx`` : tx`and number < ${before}`}
    order by number desc limit ${limit}`
