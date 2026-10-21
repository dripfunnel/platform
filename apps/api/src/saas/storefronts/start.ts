import { z } from 'zod'
import type { ScopedSql } from '#db/scoped/index'
import { beginStaffStoreRepo, beginStoreRepo, selectRunningCreation, selectStaffStart, selectStartForUpdate, type StartRow } from '#db/scoped/storefronts'
import { queueSideEffect } from '#saas/outbox/index'
import { createSteps } from './create'

// The first time a store picks a template (SAAS §5, decided 2026-10-08 on #470): its repo gets an opaque name and the
// create-storefront Workflow is asked for through the outbox, so it starts only after this transaction commits.

export const storefrontCreateKind = 'storefront.create'

export const createStorefrontParams = z.strictObject({ storeId: z.guid(), jobId: z.guid(), template: z.string().regex(/^[a-z0-9-]{1,40}$/) })
export type CreateStorefrontParams = z.infer<typeof createStorefrontParams>

// An Admin Undo of a failed job (SAAS §5, #730): the same Workflow runs the job's compensations under its own instance.
export const storefrontUndoKind = 'storefront.undo'
export const undoStorefrontParams = z.strictObject({ storeId: z.guid(), jobId: z.guid() })
export type UndoStorefrontParams = z.infer<typeof undoStorefrontParams>

export type StartResult = { ok: true; jobId: string } | { ok: false; code: 'NOT_FOUND' | 'INVALID_TEMPLATE' | 'OWN_FRONTEND' | 'ALREADY_CREATED' }

const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'

/** `sf-` and ten letters or digits (LIVE-SHOP §3): the org's public list names no merchant. */
export const opaqueRepoName = (): string => {
  let name = ''
  while (name.length < 10) {
    // 252 is the largest multiple of 36 under 256, so every character is equally likely.
    for (const byte of crypto.getRandomValues(new Uint8Array(16))) if (byte < 252 && name.length < 10) name += alphabet[byte % 36]
  }
  return `sf-${name}`
}

type Begin = (tx: ScopedSql, repo: string) => Promise<string>

const start = async (tx: ScopedSql, storeId: string, store: StartRow | null, template: string, begin: Begin): Promise<StartResult> => {
  if (!createStorefrontParams.shape.template.safeParse(template).success) return { ok: false, code: 'INVALID_TEMPLATE' }
  if (!store) return { ok: false, code: 'NOT_FOUND' }
  if (store.storefront_kind === 'own') return { ok: false, code: 'OWN_FRONTEND' }
  if (store.repo_state === 'ready') return { ok: false, code: 'ALREADY_CREATED' }
  if (store.repo_state === 'creating') {
    const running = await selectRunningCreation(tx, storeId)
    if (running) return { ok: true, jobId: running }
  }
  // A store left creating with no job (its undo never finished) keeps its name, so the next run reuses that repo.
  const jobId = await begin(tx, store.repo ?? opaqueRepoName())
  await queueSideEffect(tx, { kind: storefrontCreateKind, idempotencyKey: `${storefrontCreateKind}:${jobId}`, payload: { storeId, jobId, template }, partnerId: store.partner_id, storeId })
  return { ok: true, jobId }
}

/**
 * Starts SAAS §5 steps 4–8 for the store in `tx` (system scope), or answers the job already running. A store whose
 * last attempt failed starts again under a new name; one with its own frontend never gets a repo (PLATFORM-PROMPT §5.6).
 */
export const startStorefront = async (tx: ScopedSql, storeId: string, template: string, at: Date): Promise<StartResult> =>
  start(tx, storeId, await selectStartForUpdate(tx, storeId), template, (t, repo) => beginStoreRepo(t, storeId, repo, createSteps, at))

/** Admin Retry (platform scope): what choosing the template again does, with the template the failed job was started with. */
export const retryStorefront = async (tx: ScopedSql, failedJobId: string, at: Date): Promise<StartResult> => {
  const store = await selectStaffStart(tx, failedJobId)
  if (!store?.template) return { ok: false, code: 'NOT_FOUND' }
  return start(tx, store.store_id, store, store.template, (t, repo) => beginStaffStoreRepo(t, failedJobId, store.store_id, repo, createSteps, at))
}
