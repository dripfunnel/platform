import { maxPageSize, pgArray, type ScopedSql } from './index'
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

/** The gallery in a fixed order, Classic, "Start from scratch", then the rest by key (storefront ARCHITECTURE §2.3); one page of at most `maxPageSize`. */
export const selectOfferedTemplates = (tx: ScopedSql, shopDomain: string | null): Promise<TemplateRow[]> =>
  tx<TemplateRow[]>`
    select t.key, t.name, t.tag, t.description, case when s.id is null then null else ${storefrontHostOf(tx, shopDomain)} end as demo_host
    from storefront_template t left join store s on s.id = t.demo_store_id
    where t.state = 'offered'
    order by t.key = 'classic' desc, t.key = 'baseline' desc, t.key
    limit ${maxPageSize}`

export const isOfferedTemplate = async (tx: ScopedSql, key: string): Promise<boolean> =>
  (await tx`select 1 from storefront_template where key = ${key} and state = 'offered'`).length > 0

export type MessageRole = 'user' | 'ai' | 'note' | 'error' | 'questions' | 'plan'

export interface NewMessage {
  storeId: string
  role: MessageRole
  text: string
  changed?: readonly string[]
  imageAssetId?: string | null
  sampleUrl?: string | null
  page?: string | null
  commit?: string | null
  beforeCommit?: string | null
  aiRunId?: string | null
  /** A flow's questions, plan or build (#1243), as the studio's schema wrote it. */
  detail?: unknown
  createdBy: string | null
  at: Date
}

export const insertDesignMessage = async (tx: ScopedSql, m: NewMessage): Promise<string> => {
  const [row] = await tx<{ id: string }[]>`
    insert into design_message (store_id, role, text, changed, image_asset_id, sample_url, page, commit, before_commit, ai_run_id, detail, created_by, created_at)
    values (${m.storeId}, ${m.role}, ${m.text}, ${pgArray(m.changed ?? [])}::text[], ${m.imageAssetId ?? null}, ${m.sampleUrl ?? null},
      ${m.page ?? null}, ${m.commit ?? null}, ${m.beforeCommit ?? null}, ${m.aiRunId ?? null}, ${m.detail === undefined ? null : JSON.stringify(m.detail)}::jsonb, ${m.createdBy}, ${m.at})
    returning id`
  if (!row) throw new Error('design_message: insert returned nothing')
  return row.id
}

export interface MessageRow {
  id: string
  role: MessageRole
  text: string
  changed: string[]
  image_asset_id: string | null
  sample_url: string | null
  page: string | null
  commit: string | null
  before_commit: string | null
  undone: boolean
  ai_run_id: string | null
  detail: unknown
  created_at: Date
}

const messageColumns = (tx: ScopedSql) => tx`id, role, text, to_jsonb(changed) as changed, image_asset_id, sample_url, page, commit, before_commit, undone, ai_run_id, detail, created_at`

/** A page of the chat, newest first, before the cursor's message (keyset on created_at and id). */
export const selectDesignChat = (tx: ScopedSql, storeId: string, limit: number, before: { at: Date; id: string } | null): Promise<MessageRow[]> =>
  tx<MessageRow[]>`
    select ${messageColumns(tx)}
    from design_message
    where store_id = ${storeId} ${before ? tx`and (created_at, id) < (${before.at}, ${before.id})` : tx``}
    order by created_at desc, id desc limit ${limit}`

export interface DesignStateRow {
  repo_state: 'none' | 'creating' | 'ready' | 'failed'
  storefront_template: string | null
  live_build_id: string | null
  live_number: number | null
  live_published_at: Date | null
  live_template: string | null
  live_portal_origin: string | null
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
        d.preview_deploy_ref as draft_preview,
        -- The live home page's frame-ancestors (ARCHITECTURE §3.5): its own upload's, or for a page run the build it renders beside.
        (select substring(m.file->'headers'->>'content-security-policy' from 'frame-ancestors (https://[^ ;]+)')
          from publish_run r cross join jsonb_array_elements(r.upload_manifest->'files') m(file)
          where r.store_id = f.store_id and r.id in (f.live_build_id, (select assets_build_id from publish_run where id = f.live_build_id))
            and m.file->>'path' = 'index.html'
          order by r.id = f.live_build_id desc limit 1) as live_portal_origin
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

/** The merchant's last requests, newest first, for the model's context (storefront ARCHITECTURE §6.2: the last four). */
export const selectRecentRequests = async (tx: ScopedSql, storeId: string, limit: number): Promise<string[]> =>
  (await tx<{ text: string }[]>`select text from design_message where store_id = ${storeId} and role = 'user' order by created_at desc, id desc limit ${limit}`).map((r) => r.text)

export const selectMessage = async (tx: ScopedSql, storeId: string, id: string): Promise<MessageRow | null> =>
  (await tx<MessageRow[]>`select ${messageColumns(tx)} from design_message where store_id = ${storeId} and id = ${id}`)[0] ?? null

/** The store's latest accepted change still in place: the only one "Undo this change" takes back (AI-STUDIO §5). */
export const selectLatestChange = async (tx: ScopedSql, storeId: string): Promise<MessageRow | null> =>
  (
    await tx<MessageRow[]>`
      select ${messageColumns(tx)} from design_message
      where store_id = ${storeId} and role = 'ai' and commit is not null and not undone order by created_at desc, id desc limit 1`
  )[0] ?? null

/** The store's newest questions or plan (#1243): only it can be answered, changed or built. */
export const selectLatestFlow = async (tx: ScopedSql, storeId: string): Promise<MessageRow | null> =>
  (await tx<MessageRow[]>`select ${messageColumns(tx)} from design_message where store_id = ${storeId} and role in ('questions', 'plan') order by created_at desc, id desc limit 1`)[0] ?? null

/** Moves a flow's message on from `state` only, so two tabs can't both answer or build it; false when it had moved. */
export const moveFlow = async (tx: ScopedSql, storeId: string, id: string, state: string, detail: unknown): Promise<boolean> =>
  (await tx`update design_message set detail = ${JSON.stringify(detail)}::jsonb where store_id = ${storeId} and id = ${id} and detail->>'state' = ${state} returning id`).length > 0

export const markUndone = async (tx: ScopedSql, storeId: string, id: string): Promise<void> => {
  await tx`update design_message set undone = true where store_id = ${storeId} and id = ${id}`
}

export interface DesignUsageRow {
  ai_requests: number
  ai_tokens: number
  ai_prompts_used: number
  build_minutes: number
  publishes: number
}

/**
 * The Storefront's meters (FIRST-RELEASE §14 "AI and build minutes"): this month's merchant requests and their tokens
 * (repairs are the platform's, SAAS §9.2), `ai_prompts` as counted, build minutes of the store's own publishes (never a
 * repair's or bisect's build), and publishes live in the last 30 days.
 */
export const selectDesignUsage = async (tx: ScopedSql, storeId: string, month: Date, since: Date): Promise<DesignUsageRow> =>
  (
    await tx<DesignUsageRow[]>`
      select
        (select count(*)::int from ai_run where store_id = ${storeId} and kind = 'design' and billed_to <> 'platform' and parent_run_id is null and created_at >= ${month}) as ai_requests,
        (select coalesce(sum(tokens_in + tokens_out), 0)::int from ai_run where store_id = ${storeId} and kind = 'design' and billed_to <> 'platform' and created_at >= ${month}) as ai_tokens,
        coalesce((select used from store_usage where store_id = ${storeId} and key = 'ai_prompts' and period_start = ${month.toISOString().slice(0, 10)}::date), 0) as ai_prompts_used,
        (select coalesce(sum(build_minutes), 0)::int from publish_run where store_id = ${storeId} and attempt_of is null and created_at >= ${month}) as build_minutes,
        (select count(*)::int from publish_run where store_id = ${storeId} and attempt_of is null and kind <> 'page' and state = 'live' and finished_at >= ${since}) as publishes`
  )[0] ?? { ai_requests: 0, ai_tokens: 0, ai_prompts_used: 0, build_minutes: 0, publishes: 0 }

export interface RecentRequestRow {
  id: string
  prompt: string
  outcome: string
  tokens: number
  created_at: Date
}

/** The store's last merchant requests, newest first: its own words, which the merchant side may read (DATA-MODEL §5.3). */
export const selectRecentRuns = (tx: ScopedSql, storeId: string, limit: number): Promise<RecentRequestRow[]> =>
  tx<RecentRequestRow[]>`
    select id, prompt, outcome, tokens_in + tokens_out as tokens, created_at from ai_run
    where store_id = ${storeId} and kind = 'design' and billed_to <> 'platform' and parent_run_id is null order by created_at desc, id desc limit ${limit}`
