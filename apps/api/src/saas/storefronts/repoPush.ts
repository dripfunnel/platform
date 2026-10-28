import type postgres from 'postgres'
import { z } from 'zod'
import { withSystemScope, type ScopedSql } from '#db/scoped/index'
import { hasRunOfCommit, selectQueuedRun, selectRun, takeQueuedRun } from '#db/scoped/publishing'
import { isPlatformCommit, selectRepoByIdForUpdate, type PushedRepoRow } from '#db/scoped/storefronts'
import type { StoreRepos } from '#integrations/github/index'
import { activityLog } from '#saas/activity/index'
import { queueSideEffect } from '#saas/outbox/index'
import { startPublish } from './publish'

// A push to a store repo's `main` (#968; storefront LIVE-SHOP.md §4, "A push to `main`"): the commit builds and goes live
// as a `repo` publish, unless the platform pushed it, `main` has moved past it, or it changed the locked workflow.

export const storefrontRepoPushKind = 'storefront.repo_push'

export const repoPushParams = z.strictObject({
  repoId: z.string().regex(/^[1-9]\d{0,19}$/),
  commit: z.string().regex(/^[0-9a-f]{40}$/),
  /** The pusher's GitHub login, for the activity entry. */
  pusher: z.string().regex(/^[A-Za-z0-9-]{1,39}(\[bot\])?$/),
})
export type RepoPush = z.infer<typeof repoPushParams>

export interface RepoPushDeps {
  sql: postgres.Sql
  repos: Pick<StoreRepos, 'head' | 'lockedTree'>
  now: () => Date
}

/** `started` is a new run, waiting behind a running one if need be; `merged` took over the run already waiting. */
export type RepoPushOutcome = 'started' | 'merged' | 'unknown_repo' | 'not_ready' | 'not_live' | 'own_commit' | 'stale' | 'duplicate' | 'workflow_changed' | 'busy'

/** Waiting runs a push may take over: each builds the live commit or an older push, never the studio's or the bot's. */
const takeable = new Set(['page', 'manual', 'automatic', 'repo'])

/** Whether `commit`'s `.github` is the one at `known`, the commit the platform last knew on main (LIVE-SHOP §3 step 4). */
export const sameWorkflow = async (repos: Pick<StoreRepos, 'lockedTree'>, repo: string, known: string, commit: string): Promise<boolean> =>
  commit === known || (await repos.lockedTree(repo, known)) === (await repos.lockedTree(repo, commit))

/** A refusal is a security entry, staff only like the build calls' (LOGGING §3). */
const record = (tx: ScopedSql, store: PushedRepoRow, push: RepoPush, result: 'success' | 'denied', reason: string | null) =>
  activityLog.record(tx, {
    category: result === 'denied' ? 'security' : 'system',
    action: 'storefront.repo_publish',
    result,
    actorKind: 'provider',
    actorId: 'github',
    actorLabel: `${push.pusher} on GitHub`,
    partnerId: store.partner_id,
    storeId: store.store_id,
    target: { type: 'storefront', id: store.store_id, label: 'storefront' },
    changes: [{ field: 'commit', before: null, after: push.commit }],
    reason,
    api: 'system',
    requestId: null,
    ip: null,
    userAgent: null,
    visibility: result === 'denied' ? 'staff' : 'partner',
  })

/**
 * The hook's part, in one short transaction: a push to a store's repo is queued for `handleRepoPush` (api/README.md §5),
 * so GitHub being slow or down is retried rather than lost. Once per repo and commit.
 */
export const acceptRepoPush = (sql: postgres.Sql, push: RepoPush): Promise<'queued' | 'unknown_repo'> =>
  withSystemScope(sql, async (tx) => {
    const store = await selectRepoByIdForUpdate(tx, push.repoId)
    if (!store) return 'unknown_repo'
    await queueSideEffect(tx, { kind: storefrontRepoPushKind, idempotencyKey: `repo_push:${push.repoId}:${push.commit}`, payload: push, partnerId: store.partner_id, storeId: store.store_id })
    return 'queued'
  })

type Ready = PushedRepoRow & { repo: string; repo_head: string; live_build_id: string }

/** The store, when the push may build; otherwise why it starts nothing, before GitHub is asked anything. */
const readyStore = async (tx: ScopedSql, repoId: string, commit: string): Promise<Ready | RepoPushOutcome> => {
  const store = await selectRepoByIdForUpdate(tx, repoId)
  if (!store) return 'unknown_repo'
  const { repo, repo_head: head, live_build_id: live } = store
  if (!repo || !head || store.repo_state !== 'ready') return 'not_ready'
  if (head === commit || (await isPlatformCommit(tx, store.store_id, commit))) return 'own_commit'
  // The first live build is the merchant's first Publish (SAAS §5).
  if (!live) return 'not_live'
  return { ...store, repo, repo_head: head, live_build_id: live }
}

export const handleRepoPush = async (deps: RepoPushDeps, push: RepoPush): Promise<RepoPushOutcome> => {
  const first = await withSystemScope(deps.sql, (tx) => readyStore(tx, push.repoId, push.commit))
  if (typeof first === 'string') return first
  const changed = !(await sameWorkflow(deps.repos, first.repo, first.repo_head, push.commit))

  return withSystemScope(deps.sql, async (tx) => {
    // Under the store's lock, so two pushes take turns: only main's own head builds, never an older push delivered late.
    const store = await readyStore(tx, push.repoId, push.commit)
    if (typeof store === 'string') return store
    if ((await deps.repos.head(store.repo)) !== push.commit) return 'stale'
    if (changed) {
      await record(tx, store, push, 'denied', 'workflow_changed')
      return 'workflow_changed'
    }
    if (await hasRunOfCommit(tx, store.store_id, push.commit)) return 'duplicate'
    const waiting = await selectQueuedRun(tx, store.store_id)
    // The studio's or the bot's waiting run goes first; the push is tried again after it.
    if (waiting && !takeable.has(waiting.kind)) return 'busy'
    if (waiting) {
      await takeQueuedRun(tx, store.store_id, waiting.id, push.commit)
      await record(tx, store, push, 'success', null)
      return 'merged'
    }
    const live = await selectRun(tx, store.live_build_id)
    if (!live) return 'not_live'
    const started = await startPublish(tx, { storeId: store.store_id, kind: 'repo', commit: push.commit, template: live.template, coreVersion: live.core_version, usesAllowance: false, startedBy: { kind: 'system', id: null }, at: deps.now() })
    if (!started.ok) return 'not_ready'
    await record(tx, store, push, 'success', null)
    return 'started'
  })
}
