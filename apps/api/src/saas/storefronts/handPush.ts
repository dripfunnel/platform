import type postgres from 'postgres'
import { withSystemScope, type ScopedSql } from '#db/scoped/index'
import { adoptRepoHead, selectRepoAtRest } from '#db/scoped/storefronts'
import type { RepoChange, StoreRepos } from '#integrations/github/index'
import { isThemePath } from './paths'

// A hand push to a store repo's `main` (LIVE-SHOP §4 step 2): a design publish takes its theme changes into the draft first.

export interface HandPush {
  from: string
  head: string
  /** The theme files the push changed since the platform's last commit; the draft's other changes stay. */
  changes: RepoChange[]
}

/** What was pushed past the platform's last commit; null when `main` is where the platform left it. */
export const handPushOf = async (sql: postgres.Sql, repos: StoreRepos, storeId: string): Promise<HandPush | null> => {
  const store = await withSystemScope(sql, (tx) => selectRepoAtRest(tx, storeId))
  if (!store?.repo || !store.repo_head || store.repo_state !== 'ready') return null
  const head = await repos.head(store.repo)
  if (!head || head === store.repo_head) return null
  return { from: store.repo_head, head, changes: await repos.changes(store.repo, store.repo_head, head, isThemePath) }
}

/** The draft took the push: the publish's own commit then fast-forwards from it (push.ts). False when another Publish took it first. */
export const adoptHandPush = (tx: ScopedSql, storeId: string, push: Pick<HandPush, 'from' | 'head'>): Promise<boolean> => adoptRepoHead(tx, storeId, push.from, push.head)
