import type postgres from 'postgres'
import type { ActivityEntry, ActivityLog, RequestFacts } from '#auth/activity'
import type { TenantContext } from '#core/tenancy'
import { insertDesignMessage, isOfferedTemplate, selectDesignState, selectOfferedTemplates, selectVersionHistory, type DesignStateRow, type NewMessage, type VersionHistoryRow } from '#db/scoped/design'
import { withScope, withSystemScope, type ScopedSql } from '#db/scoped/index'
import { selectStorefrontHost } from '#db/scoped/publishing'
import { UNLIMITED } from '#db/scoped/planKeys'
import { allowanceFor } from '#saas/entitlements/index'
import { startStorefront } from '#saas/storefronts/index'
import { createStorefrontSettingsService } from '#saas/storefrontSettings/index'
import type { StudioApi } from '#saas/studio/index'
import { designAudit, designNotes } from './words'

// The Store API's Storefront area (FIRST-RELEASE §14, §19; SAAS §9.2): the Owner changes the design (`publish`), the
// Manager reads it (`storefront.read`). Every read and write names the TenantContext's store, and its studio by it.

export interface DesignerDeps {
  sql: postgres.Sql
  context: TenantContext
  actor: { id: string; partnerId: string }
  activity: ActivityLog
  facts: RequestFacts
  /** The store's StudioSession; null where the Worker has none bound. */
  studio: StudioApi | null
  now: () => Date
}

export type DesignRefusal =
  | {
      reason:
        | 'BRAND_NOT_READY'
        | 'INVALID_TEMPLATE'
        | 'IN_PROGRESS'
        | 'NOT_CONNECTED'
        | 'STUDIO_UNAVAILABLE'
        | 'NOT_FOUND'
        | 'INVALID_INPUT'
        | 'INVALID_IMAGE'
        | 'INVALID_URL'
        | 'INVALID_LANGUAGE'
        | 'SAMPLE_UNAVAILABLE'
        | 'AI_BUDGET_REACHED'
        | 'AI_NOT_CONNECTED'
        | 'SESSION_ENDED'
        | 'NOT_LATEST'
        | 'NOTHING_TO_DISCARD'
    }
  | { reason: 'STUDIO_QUEUED'; place: number }
  | { reason: 'CHANGE_REFUSED'; problems: number }

export type DesignResult<T> = { ok: true; value: T } | ({ ok: false } & DesignRefusal)

export interface TemplateView {
  key: string
  name: string
  tag: string
  description: string
  demoUrl: string | null
  current: boolean
}

export type DesignStatus = 'not_started' | 'creating' | 'create_failed' | 'not_published' | 'same_as_live' | 'unpublished_changes'

export interface StorefrontView {
  status: DesignStatus
  template: string | null
  live: { number: number; publishedAt: Date; template: string | null } | null
  draft: { template: string; changedAt: Date | null; previewReady: boolean } | null
  history: VersionHistoryRow[]
}

const statusOf = (s: DesignStateRow): DesignStatus => {
  if (s.repo_state === 'none') return 'not_started'
  if (s.repo_state === 'creating') return 'creating'
  if (s.repo_state === 'failed') return 'create_failed'
  if (s.live_number === null) return 'not_published'
  return s.draft_head ? 'unpublished_changes' : 'same_as_live'
}

const dayMs = 86_400_000

export const createDesignerService = ({ sql, context, actor, activity, facts, studio, now }: DesignerDeps) => {
  const { storeId } = context

  const entry = (action: string, changes: NonNullable<ActivityEntry['changes']>, reason: string | null = null): ActivityEntry => ({
    category: 'write',
    action,
    result: 'success',
    actorKind: 'person',
    actorId: actor.id,
    actorLabel: null,
    partnerId: actor.partnerId,
    storeId,
    sellerId: null,
    target: { type: 'storefront', id: storeId, label: 'storefront' },
    changes,
    reason,
    api: 'store',
    visibility: 'store',
    ...facts,
  })

  const note = (tx: ScopedSql, text: string) => insertDesignMessage(tx, { storeId, role: 'note', text, createdBy: actor.id, at: now() } satisfies NewMessage)

  const state = async (tx: ScopedSql) => {
    const found = await selectDesignState(tx, storeId)
    if (!found) throw new Error('storefront: the store has no storefront row')
    return found
  }

  /** The gallery, with the template the draft (or else the live site) uses marked "Your current look". */
  const templates = async (): Promise<TemplateView[]> => {
    const current = await withScope(sql, context, async (tx) => {
      const s = await state(tx)
      return s.draft_template ?? s.live_template ?? s.storefront_template
    })
    return withSystemScope(sql, async (tx) =>
      Promise.all(
        (await selectOfferedTemplates(tx)).map(async (t) => {
          const host = t.demo_store_id ? await selectStorefrontHost(tx, t.demo_store_id) : null
          return { key: t.key, name: t.name, tag: t.tag, description: t.description, demoUrl: host ? `https://${host}` : null, current: t.key === current }
        }),
      ),
    )
  }

  /**
   * SAAS §9.2 `chooseTemplate`: refused until the brand is ready; the first time it starts the create-storefront Workflow
   * (§5 steps 4–8), later the template becomes a change to the private draft and nothing reaches the repo.
   */
  const chooseTemplate = async (key: string, keep: boolean): Promise<DesignResult<DesignStatus>> => {
    const brand = await createStorefrontSettingsService({ sql, context, actor, activity, facts, now }).brand()
    if (!brand?.ready) return { ok: false, reason: 'BRAND_NOT_READY' }
    const before = { state: await withScope(sql, context, state) }
    if (!(await withSystemScope(sql, (tx) => isOfferedTemplate(tx, key)))) return { ok: false, reason: 'INVALID_TEMPLATE' }
    const was = before.state.draft_template ?? before.state.live_template ?? before.state.storefront_template
    const record = async (tx: ScopedSql) => {
      await note(tx, designNotes.templateChosen(key))
      await activity.record(tx, entry(designAudit.templateChosen, [{ field: 'template', before: was, after: key }, { field: 'words', before: null, after: keep ? 'kept' : 'template' }]))
    }
    if (before.state.repo_state === 'creating') return { ok: false, reason: 'IN_PROGRESS' }
    if (before.state.repo_state !== 'ready') {
      const started = await withSystemScope(sql, async (tx) => {
        const result = await startStorefront(tx, storeId, key, now())
        if (result.ok) await record(tx)
        return result
      })
      if (!started.ok) return started.code === 'INVALID_TEMPLATE' ? { ok: false, reason: 'INVALID_TEMPLATE' } : { ok: false, reason: 'IN_PROGRESS' }
      return { ok: true, value: 'creating' }
    }
    if (!studio) return { ok: false, reason: 'NOT_CONNECTED' }
    const answer = await studio.useTemplate(storeId, { template: key, keep, userId: actor.id })
    if (answer.outcome === 'queued') return { ok: false, reason: 'STUDIO_QUEUED', place: answer.place }
    if (answer.outcome === 'unavailable') return { ok: false, reason: 'STUDIO_UNAVAILABLE' }
    if (answer.outcome === 'refused') return { ok: false, reason: 'CHANGE_REFUSED', problems: answer.problems.length }
    await withSystemScope(sql, record)
    return { ok: true, value: (await overview()).status }
  }

  /** `storefront`: the status line, the live version, the draft and the history the plan keeps (FIRST-RELEASE §14). */
  const overview = async (): Promise<StorefrontView> => {
    const days = await allowanceFor(sql, context, 'history_days', now())
    const since = days >= UNLIMITED ? new Date(0) : new Date(now().getTime() - days * dayMs)
    return withScope(sql, context, async (tx) => {
      const s = await state(tx)
      return {
        status: statusOf(s),
        template: s.draft_template ?? s.live_template ?? s.storefront_template,
        live: s.live_number !== null && s.live_published_at ? { number: s.live_number, publishedAt: s.live_published_at, template: s.live_template } : null,
        draft: s.draft_template && s.draft_head ? { template: s.draft_template, changedAt: s.draft_changed_at, previewReady: s.draft_preview !== null } : null,
        history: await selectVersionHistory(tx, storeId, since),
      }
    })
  }

  return { templates, chooseTemplate, overview }
}

export type DesignerService = ReturnType<typeof createDesignerService>
