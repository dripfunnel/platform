import type { ScopedSql } from './index'

// A store's repo and the platform's pushes to it (DATA-MODEL §7.8, storefront_push), always in system scope: only
// jobs create repos and push.

export type RepoState = 'none' | 'creating' | 'ready' | 'failed'

export interface StoreRepoRow {
  repo: string | null
  repo_state: RepoState
  repo_head: string | null
}

export interface PushRow {
  parent_sha: string
  commit_sha: string | null
  state: 'pending' | 'done'
  created_at: Date
}

/** Locked to the end of the transaction, so two pushes for one store agree on the parent. */
export const selectStoreRepoForUpdate = async (tx: ScopedSql, storeId: string): Promise<StoreRepoRow | null> =>
  (await tx<StoreRepoRow[]>`select repo, repo_state, repo_head from storefront where store_id = ${storeId} for update`)[0] ?? null

export const selectPush = async (tx: ScopedSql, storeId: string, key: string): Promise<PushRow | null> =>
  (await tx<PushRow[]>`select parent_sha, commit_sha, state, created_at from storefront_push where store_id = ${storeId} and key = ${key}`)[0] ?? null

export const insertPush = async (tx: ScopedSql, storeId: string, key: string, parent: string, at: Date): Promise<PushRow> => {
  const [row] = await tx<PushRow[]>`
    insert into storefront_push (store_id, key, parent_sha, state, created_at) values (${storeId}, ${key}, ${parent}, 'pending', ${at})
    returning parent_sha, commit_sha, state, created_at`
  if (!row) throw new Error('storefront_push: insert returned nothing')
  return row
}

export const setPushCommit = async (tx: ScopedSql, storeId: string, key: string, commit: string): Promise<void> => {
  await tx`update storefront_push set commit_sha = ${commit} where store_id = ${storeId} and key = ${key} and state = 'pending'`
}

/** A refused push leaves no row, so the same key may try again from wherever `main` then is. */
export const deletePendingPush = async (tx: ScopedSql, storeId: string, key: string): Promise<void> => {
  await tx`delete from storefront_push where store_id = ${storeId} and key = ${key} and state = 'pending'`
}

/** `main` is at `commit` on GitHub: the store's record follows, unless another push already moved it on. */
export const finishPush = async (tx: ScopedSql, storeId: string, key: string, parent: string, commit: string, at: Date): Promise<void> => {
  await tx`update storefront set repo_head = ${commit} where store_id = ${storeId} and repo_head = ${parent}`
  await tx`update storefront_push set state = 'done', commit_sha = ${commit}, finished_at = ${at} where store_id = ${storeId} and key = ${key}`
}
