import type postgres from 'postgres'
import type { ActivityEntry, ActivityLog, RequestFacts } from '#auth/activity'
import type { PageWindow } from '#core/paging'
import type { TenantContext } from '#core/tenancy'
import {
  copyStoryDraft,
  countStoryBlocks,
  deleteStoryBlock,
  insertStory,
  insertStoryBlock,
  maxStoryBlocks,
  publishStoryDraft,
  readableProducts,
  selectStory,
  selectStoryBlock,
  selectStoryBlocks,
  storyRefused,
  updateStoryBlock,
  updateStoryDraft,
  type StoryRow,
} from '#db/scoped/catalogStory'
import { approvalRequired, submitForApproval } from '#db/scoped/approval'
import { serialise, withScope, type ScopedSql } from '#db/scoped/index'
import { approvalAudit } from './approval'
import { cleanStory, cleanStoryBlock, maxCopyTargets, StoryInvalid, storyGaps, type StoryBlockInput, type StoryGap, type StoryInput, type StoryModule } from './storyRules'
import { isUuid } from '#core/ids'

// A+ content (CATALOG Q): a draft saved apart from the live page and published on its own (Q9). A
// supplier writes its own products' stories through its scope; brand stories are the merchant's (Q5).

export const storyAudit = {
  saved: 'product_story.saved',
  published: 'product_story.published',
  copied: 'product_story.copied',
  blockSaved: 'story_block.saved',
  blockDeleted: 'story_block.deleted',
} as const

export type StoryRefusal =
  | { reason: 'INVALID_STORY'; field: string }
  | { reason: 'NOT_FOUND' }
  | { reason: 'STALE_REVISION'; revision: number }
  | { reason: 'STORY_REFUSED' }
  | { reason: 'STORY_INCOMPLETE'; gaps: StoryGap[] }
  | { reason: 'TOO_MANY_STORY_BLOCKS' }
  | { reason: 'STORY_BLOCK_IN_USE' }
export type StoryResult<T> = { ok: true; value: T } | ({ ok: false } & StoryRefusal)

export type StoryStatus = 'draft' | 'live' | 'changed'
export interface Story {
  productId: string
  template: string | null
  modules: StoryModule[]
  status: StoryStatus
  publishedAt: Date | null
  revision: number
  updatedAt: Date | null
}


class Refused extends Error {
  constructor(readonly refusal: StoryRefusal) {
    super(refusal.reason)
  }
}

// Both documents come back from jsonb, so equal modules serialise alike.
const statusOf = (row: StoryRow): StoryStatus => (row.live === null ? 'draft' : JSON.stringify(row.live) === JSON.stringify(row.draft) ? 'live' : 'changed')

const storyOf = (productId: string, row: StoryRow | null): Story =>
  row
    ? { productId, template: row.template, modules: row.draft as StoryModule[], status: statusOf(row), publishedAt: row.published_at, revision: row.revision, updatedAt: row.updated_at }
    : { productId, template: null, modules: [], status: 'draft', publishedAt: null, revision: 0, updatedAt: null }

export interface StoryDeps {
  sql: postgres.Sql
  context: TenantContext
  actor: { id: string; partnerId: string }
  activity: ActivityLog
  facts: RequestFacts
  now: () => Date
}

export const createStoryService = ({ sql, context, actor, activity, facts, now }: StoryDeps) => {
  const { storeId } = context
  const sellerId = context.sellerScope.kind === 'seller' ? context.sellerScope.sellerId : null
  const inScope = <T>(work: (tx: ScopedSql) => Promise<T>) => withScope(sql, context, work)

  const entry = (action: string, target: { type: string; id: string; label: string }): ActivityEntry => ({
    category: 'write',
    action,
    result: 'success',
    actorKind: 'person',
    actorId: actor.id,
    actorLabel: null,
    partnerId: actor.partnerId,
    storeId,
    sellerId,
    target,
    reason: null,
    api: 'store',
    visibility: 'store',
    ...facts,
  })

  const run = async <T>(work: (tx: ScopedSql) => Promise<T>): Promise<StoryResult<T>> => {
    try {
      return { ok: true, value: await inScope(work) }
    } catch (error) {
      if (error instanceof Refused) return { ok: false, ...error.refusal }
      if (error instanceof StoryInvalid) return { ok: false, reason: 'INVALID_STORY', field: error.field }
      if (storyRefused(error)) return { ok: false, reason: 'STORY_REFUSED' }
      throw error
    }
  }

  const productName = async (tx: ScopedSql, productId: string): Promise<string> => {
    if (!isUuid(productId)) throw new Refused({ reason: 'NOT_FOUND' })
    const [row] = await tx<{ name: string }[]>`select name from product where id = ${productId} and store_id = ${storeId} and deleted_at is null`
    if (!row) throw new Refused({ reason: 'NOT_FOUND' })
    return row.name
  }

  /** Null when the caller can't read the product; a product with no story yet has an empty draft at revision 0. */
  const story = (productId: string) =>
    inScope(async (tx) => {
      if (!isUuid(productId) || (await readableProducts(tx, storeId, [productId])).length === 0) return null
      return storyOf(productId, await selectStory(tx, storeId, productId))
    })

  const save = (productId: string, revision: number, input: StoryInput) =>
    run(async (tx) => {
      const name = await productName(tx, productId)
      const clean = cleanStory(input, productId, sellerId !== null)
      const done = revision === 0 ? await insertStory(tx, storeId, productId, clean.template, clean.modules) : await updateStoryDraft(tx, storeId, productId, revision, clean.template, clean.modules, now())
      if (!done) throw new Refused({ reason: 'STALE_REVISION', revision: (await selectStory(tx, storeId, productId))?.revision ?? 0 })
      await activity.record(tx, entry(storyAudit.saved, { type: 'product', id: productId, label: name }))
      return storyOf(productId, await selectStory(tx, storeId, productId))
    })

  // Q11's review of a supplier's story comes with approval (SAPI 5); until then it publishes as the product saves.
  const publish = (productId: string, revision: number) =>
    run(async (tx) => {
      const name = await productName(tx, productId)
      const row = await selectStory(tx, storeId, productId)
      if (!row || row.revision !== revision) throw new Refused({ reason: 'STALE_REVISION', revision: row?.revision ?? 0 })
      const gaps = storyGaps(row.draft as StoryModule[])
      if (gaps.length > 0) throw new Refused({ reason: 'STORY_INCOMPLETE', gaps })
      if (!(await publishStoryDraft(tx, storeId, productId, revision, now()))) throw new Refused({ reason: 'STALE_REVISION', revision })
      await activity.record(tx, entry(storyAudit.published, { type: 'product', id: productId, label: name }))
      // Q11: a supplier's A+ is reviewed with its product, which waits for approval again while it's on.
      if (sellerId !== null && (await approvalRequired(tx)) && (await submitForApproval(tx, storeId, productId, now()))) {
        await activity.record(tx, { ...entry(approvalAudit.sentBackForApproval, { type: 'product', id: productId, label: name }), reason: 'A+ content' })
      }
      return storyOf(productId, await selectStory(tx, storeId, productId))
    })

  /** Q6: the source's draft becomes each target's draft; the answer is how many products got it. */
  const copy = (fromId: string, toIds: readonly string[]) =>
    run(async (tx) => {
      const name = await productName(tx, fromId)
      const targets = [...new Set(toIds.map((t) => t.toLowerCase()))].filter((t) => t !== fromId.toLowerCase())
      if (targets.length === 0 || targets.length > maxCopyTargets || !targets.every((t) => isUuid(t))) throw new Refused({ reason: 'INVALID_STORY', field: 'toProductIds' })
      if ((await readableProducts(tx, storeId, targets)).length !== targets.length) throw new Refused({ reason: 'NOT_FOUND' })
      const source = await selectStory(tx, storeId, fromId)
      if (!source || source.draft.length === 0) throw new Refused({ reason: 'NOT_FOUND' })
      // A copy compares only products still there, and never a target with itself.
      const modules = source.draft as StoryModule[]
      const live = new Set(await readableProducts(tx, storeId, modules.flatMap((m) => (m.kind === 'compare' ? m.productIds : []))))
      const copies = targets.map((productId) => ({
        productId,
        draft: modules.map((m) => (m.kind === 'compare' ? { ...m, productIds: m.productIds.filter((p) => p !== productId && live.has(p)) } : m)),
      }))
      await copyStoryDraft(tx, storeId, copies, source.template, now())
      await activity.recordAll(tx, targets.map((id) => entry(storyAudit.copied, { type: 'product', id, label: `from ${name}` })))
      return targets.length
    })

  const blocks = (window: PageWindow) => inScope((tx) => selectStoryBlocks(tx, storeId, window))

  const block = (id: string) => inScope((tx) => (isUuid(id) ? selectStoryBlock(tx, storeId, id) : Promise.resolve(null)))

  const saveBlock = (id: string | null, revision: number | null, input: StoryBlockInput) =>
    run(async (tx) => {
      const clean = cleanStoryBlock(input)
      let blockId: string
      if (id === null) {
        await serialise(tx, `story_block:${storeId}`)
        if ((await countStoryBlocks(tx, storeId)) >= maxStoryBlocks) throw new Refused({ reason: 'TOO_MANY_STORY_BLOCKS' })
        blockId = crypto.randomUUID()
        await insertStoryBlock(tx, storeId, blockId, clean.name, clean.content)
      } else {
        if (!isUuid(id) || revision === null) throw new Refused({ reason: 'NOT_FOUND' })
        if (!(await updateStoryBlock(tx, storeId, id, revision, clean.name, clean.content, now()))) {
          const current = await selectStoryBlock(tx, storeId, id)
          throw new Refused(current ? { reason: 'STALE_REVISION', revision: current.revision } : { reason: 'NOT_FOUND' })
        }
        blockId = id
      }
      await activity.record(tx, entry(storyAudit.blockSaved, { type: 'story_block', id: blockId, label: clean.name }))
      return { id: blockId, revision: id === null ? 1 : (revision ?? 0) + 1 }
    })

  const removeBlock = (id: string) =>
    run(async (tx) => {
      const gone = isUuid(id) ? await deleteStoryBlock(tx, storeId, id) : null
      if (gone === null) throw new Refused({ reason: 'NOT_FOUND' })
      if (gone === 'in_use') throw new Refused({ reason: 'STORY_BLOCK_IN_USE' })
      await activity.record(tx, entry(storyAudit.blockDeleted, { type: 'story_block', id, label: gone.name }))
      return true
    })

  return { story, save, publish, copy, blocks, block, saveBlock, removeBlock }
}
