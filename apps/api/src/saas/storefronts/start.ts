import { z } from 'zod'
import type { ScopedSql } from '#db/scoped/index'
import { beginStoreRepo, selectRunningCreation, selectStartForUpdate } from '#db/scoped/storefronts'
import { queueSideEffect } from '#saas/outbox/index'
import { createSteps } from './create'

// The first time a store picks a template (SAAS §5, decided 2026-10-08 on #470): its repo gets an opaque name and the
// create-storefront Workflow is asked for through the outbox, so it starts only after this transaction commits.

export const storefrontCreateKind = 'storefront.create'

export const createStorefrontParams = z.strictObject({ storeId: z.guid(), jobId: z.guid(), template: z.string().regex(/^[a-z0-9-]{1,40}$/) })
export type CreateStorefrontParams = z.infer<typeof createStorefrontParams>

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

/**
 * Starts SAAS §5 steps 4–8 for the store in `tx` (system scope), or answers the job already running. A store whose
 * last attempt failed starts again under a new name; one with its own frontend never gets a repo (PLATFORM-PROMPT §5.6).
 */
export const startStorefront = async (tx: ScopedSql, storeId: string, template: string, at: Date): Promise<StartResult> => {
  if (!createStorefrontParams.shape.template.safeParse(template).success) return { ok: false, code: 'INVALID_TEMPLATE' }
  const store = await selectStartForUpdate(tx, storeId)
  if (!store) return { ok: false, code: 'NOT_FOUND' }
  if (store.storefront_kind === 'own') return { ok: false, code: 'OWN_FRONTEND' }
  if (store.repo_state === 'ready') return { ok: false, code: 'ALREADY_CREATED' }
  if (store.repo_state === 'creating') {
    const running = await selectRunningCreation(tx, storeId)
    if (running) return { ok: true, jobId: running }
  }
  // A store left creating with no job (its undo never finished) keeps its name, so the next run reuses that repo.
  const jobId = await beginStoreRepo(tx, storeId, store.repo ?? opaqueRepoName(), createSteps, at)
  await queueSideEffect(tx, { kind: storefrontCreateKind, idempotencyKey: `${storefrontCreateKind}:${jobId}`, payload: { storeId, jobId, template }, partnerId: store.partner_id, storeId })
  return { ok: true, jobId }
}
