import type postgres from 'postgres'
import { z } from 'zod'
import { withSystemScope } from '#db/scoped/index'
import { deletePendingPush, finishPush, insertPush, selectPush, selectStoreRepoForUpdate, setPushCommit, type PushRow, type RepoState } from '#db/scoped/storefronts'
import type { RepoChange, StoreRepos } from '#integrations/github/index'
import { isLockedPath, isRepoPath, isThemePath } from './paths'

// The push API (storefront AI-STUDIO.md §6, LIVE-SHOP.md §4 step 9): one squashed commit on `main` per call, with a
// message the platform writes, fast-forward only. Callers: the publish pipeline, the upgrade bot, a template change.

export interface PushDeps {
  sql: postgres.Sql
  repos: StoreRepos
  now: () => Date
}

const file = z.strictObject({ path: z.string().refine(isRepoPath, 'not a plain relative path'), content: z.string() })
export type RepoFile = z.infer<typeof file>

const reason = z.discriminatedUnion('kind', [
  // A design went live: its whole theme, never a merchant's words in the message.
  z.strictObject({ kind: z.literal('publish'), version: z.number().int().positive(), buildId: z.guid() }),
  // The merchant chose another template: its whole theme (with their own words if they kept them).
  z.strictObject({ kind: z.literal('template'), template: z.string().regex(/^[a-z0-9-]{1,40}$/) }),
  // The upgrade bot: the new pin and the codemods' edits, anywhere but the locked workflow.
  z.strictObject({ kind: z.literal('upgrade'), coreVersion: z.string().regex(/^\d+\.\d+\.\d+$/) }),
])
export type PushReason = z.infer<typeof reason>

const request = z.strictObject({
  storeId: z.guid(),
  key: z.string().min(1).max(200),
  reason,
  files: z.array(file).max(1000),
  removed: z.array(z.string().refine(isRepoPath)).max(1000).default([]),
})

export type PushRefusal = 'INVALID' | 'NOT_READY' | 'MAIN_MOVED' | 'PATH_NOT_ALLOWED'
export type PushResult = { ok: true; commit: string } | { ok: false; code: PushRefusal }

const messageOf = (r: PushReason): string => {
  switch (r.kind) {
    case 'publish':
      return `Publish version ${r.version}\n\nBuild ${r.buildId}`
    case 'template':
      return `Start from the ${r.template} template`
    case 'upgrade':
      return `Upgrade storefront-core to ${r.coreVersion}`
  }
}

/** Builds the new tree from the parent's; `paths` lists the parent's files when the plan needs them. */
export type TreePlan = (paths: () => Promise<string[]>) => Promise<{ replace: boolean; changes: RepoChange[] }>

/**
 * One commit on `main` from the store's recorded head, once per `key`. Retried after a crash, it rebuilds the same commit
 * (same tree, parent and date) and finds it already on `main`, so it never pushes twice. Platform callers only.
 */
export const commitToMain = async (deps: PushDeps, storeId: string, key: string, message: string, states: readonly RepoState[], plan: TreePlan): Promise<PushResult> => {
  const claimed = await withSystemScope(deps.sql, async (tx): Promise<{ repo: string; push: PushRow } | PushRefusal | { done: string }> => {
    const store = await selectStoreRepoForUpdate(tx, storeId)
    if (!store?.repo || !store.repo_head || !states.includes(store.repo_state)) return 'NOT_READY'
    const push = await selectPush(tx, storeId, key)
    if (push?.state === 'done' && push.commit_sha) return { done: push.commit_sha }
    return { repo: store.repo, push: push ?? (await insertPush(tx, storeId, key, store.repo_head, deps.now())) }
  })
  if (typeof claimed === 'string') return { ok: false, code: claimed }
  if ('done' in claimed) return { ok: true, commit: claimed.done }
  const { repo, push } = claimed

  const finish = async (commit: string): Promise<PushResult> => {
    await withSystemScope(deps.sql, (tx) => finishPush(tx, storeId, key, push.parent_sha, commit, deps.now()))
    return { ok: true, commit }
  }
  const refuse = async (): Promise<PushResult> => {
    await withSystemScope(deps.sql, (tx) => deletePendingPush(tx, storeId, key))
    return { ok: false, code: 'MAIN_MOVED' }
  }

  // An earlier attempt's commit already on main, even if main has moved on since, is this push done (never a second).
  const landed = async (commit: string, head: string | null) => head !== null && (head === commit || (await deps.repos.reaches(repo, head, commit)))
  const head = await deps.repos.head(repo)
  if (push.commit_sha && head !== push.parent_sha && (await landed(push.commit_sha, head))) return finish(push.commit_sha)
  if (head !== push.parent_sha) return refuse()

  const parentTree = await deps.repos.treeOf(repo, push.parent_sha)
  const { replace, changes } = await plan(() => deps.repos.paths(repo, parentTree))
  const tree = await deps.repos.writeTree(repo, replace ? null : parentTree, changes)
  const commit = await deps.repos.commit(repo, { tree, parent: push.parent_sha, message, at: push.created_at })
  await withSystemScope(deps.sql, (tx) => setPushCommit(tx, storeId, key, commit))
  if (await deps.repos.advance(repo, commit)) return finish(commit)
  // A lost answer to an advance that landed reads as a refusal the second time.
  return (await landed(commit, await deps.repos.head(repo))) ? finish(commit) : refuse()
}

/** The push API: a publish or template change replaces the theme; the upgrade bot changes what it names. Never `.github/**`. */
export const pushToRepo = async (deps: PushDeps, input: unknown): Promise<PushResult> => {
  const parsed = request.safeParse(input)
  if (!parsed.success) return { ok: false, code: 'INVALID' }
  const { storeId, key, reason: why, files, removed } = parsed.data
  const paths = [...files.map((f) => f.path), ...removed]
  if (paths.some(isLockedPath)) return { ok: false, code: 'PATH_NOT_ALLOWED' }
  const theme = why.kind !== 'upgrade'
  // ARCHITECTURE §3.4: a theme push writes only the allowlist; the platform's own may write anywhere but .github.
  if (theme && (removed.length > 0 || !files.every((f) => isThemePath(f.path)))) return { ok: false, code: 'PATH_NOT_ALLOWED' }

  const written = new Set(files.map((f) => f.path))
  const plan: TreePlan = async (parentPaths) => {
    const deleted = theme ? (await parentPaths()).filter((p) => isThemePath(p) && !written.has(p)) : removed
    return { replace: false, changes: [...deleted.map((path) => ({ path, content: null })), ...files] }
  }
  return commitToMain(deps, storeId, key, messageOf(why), ['ready'], plan)
}
