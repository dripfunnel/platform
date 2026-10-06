import type postgres from 'postgres'
import type { PageWindow } from '#core/paging'
import { pgArray, type ScopedSql } from './index'

// A+ content and brand stories (DATA-MODEL §7.3, migration 0045). The modules are one jsonb document; the
// trigger checks what they name, so a refusal here is the caller's to see (`storyRefused`).

const doc = (tx: ScopedSql, value: unknown) => tx.json(value as postgres.JSONValue)

export const maxStoryBlocks = 50

export interface StoryRow {
  product_id: string
  seller_id: string | null
  template: string | null
  draft: unknown[]
  live: unknown[] | null
  published_at: Date | null
  revision: number
  updated_at: Date
}

export const selectStory = async (tx: ScopedSql, storeId: string, productId: string): Promise<StoryRow | null> =>
  (
    await tx<StoryRow[]>`
      select product_id, seller_id, template, draft, live, published_at, revision, updated_at
      from product_story where product_id = ${productId} and store_id = ${storeId}
    `
  )[0] ?? null

/** The first save; false when someone else saved first. */
export const insertStory = async (tx: ScopedSql, storeId: string, productId: string, template: string | null, draft: unknown[]): Promise<boolean> =>
  (
    await tx`
      insert into product_story (product_id, store_id, template, draft) values (${productId}, ${storeId}, ${template}, ${doc(tx, draft)})
      on conflict (product_id) do nothing returning product_id
    `
  ).length === 1

/** At the revision the editor read; false when it was stale. */
export const updateStoryDraft = async (tx: ScopedSql, storeId: string, productId: string, revision: number, template: string | null, draft: unknown[], now: Date): Promise<boolean> =>
  (
    await tx`
      update product_story set template = ${template}, draft = ${doc(tx, draft)}, updated_at = ${now}, revision = revision + 1
      where product_id = ${productId} and store_id = ${storeId} and revision = ${revision} returning product_id
    `
  ).length === 1

/** An empty draft takes the story off the page. */
export const publishStoryDraft = async (tx: ScopedSql, storeId: string, productId: string, revision: number, now: Date): Promise<boolean> =>
  (
    await tx`
      update product_story set live = case when jsonb_array_length(draft) = 0 then null else draft end,
        published_at = ${now}, updated_at = ${now}, revision = revision + 1
      where product_id = ${productId} and store_id = ${storeId} and revision = ${revision} returning product_id
    `
  ).length === 1

/** Each target's own copy becomes its draft, created where there is none; the live pages are untouched (Q6, Q9). */
export const copyStoryDraft = async (tx: ScopedSql, storeId: string, copies: readonly { productId: string; draft: unknown[] }[], template: string | null, now: Date): Promise<void> => {
  await tx`
    insert into product_story (product_id, store_id, template, draft)
    select c."productId", ${storeId}, ${template}, c.draft from jsonb_to_recordset(${doc(tx, copies)}) as c("productId" uuid, draft jsonb)
    on conflict (product_id) do update set template = excluded.template, draft = excluded.draft, updated_at = ${now}, revision = product_story.revision + 1
  `
}

/** The products the caller reads among `ids`, live ones only. */
export const readableProducts = async (tx: ScopedSql, storeId: string, ids: readonly string[]): Promise<string[]> =>
  (await tx<{ id: string }[]>`select id from product where id = any (${pgArray(ids)}::uuid[]) and store_id = ${storeId} and deleted_at is null`).map((r) => r.id)

/** These products by name, those the caller reads: a comparison's chips, in one read. */
export const selectProductNames = async (tx: ScopedSql, storeId: string, ids: readonly string[]): Promise<{ id: string; name: string }[]> =>
  ids.length === 0 ? [] : tx<{ id: string; name: string }[]>`select id, name from product where id = any (${pgArray(ids)}::uuid[]) and store_id = ${storeId} and deleted_at is null`

export const storyRefused = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string' && /catalogue: (a story |a brand story |that file is another owner)/.test(error.message)

export interface StoryBlockSummaryRow {
  id: string
  name: string
  products: number
  updated_at: Date
}

export interface StoryBlockRow extends StoryBlockSummaryRow {
  content: { title: string; body: string; photo: { assetId: string | null; alt: string | null } | null }
  revision: number
}

// "Used on 48 products" (Q5) counts live products whose draft or live story shows the block.
const usedOn = (tx: ScopedSql) => tx`(select count(*)::int from product_story s join product p on p.id = s.product_id where s.block_ids @> array[b.id] and p.deleted_at is null)`

export const selectStoryBlocks = (tx: ScopedSql, storeId: string, window: PageWindow): Promise<StoryBlockSummaryRow[]> => {
  const backwards = window.before !== null && window.after === null
  return tx<StoryBlockSummaryRow[]>`
    select b.id, b.name, b.updated_at, ${usedOn(tx)} as products
    from story_block b where b.store_id = ${storeId}
      and ${window.after ? tx`(b.updated_at, b.id) < (${window.after.occurredAt}, ${window.after.id})` : tx`true`}
      and ${window.before ? tx`(b.updated_at, b.id) > (${window.before.occurredAt}, ${window.before.id})` : tx`true`}
    order by b.updated_at ${backwards ? tx`asc` : tx`desc`}, b.id ${backwards ? tx`asc` : tx`desc`}
    limit ${window.limit + 1}
  `
}

export const selectStoryBlock = async (tx: ScopedSql, storeId: string, id: string): Promise<StoryBlockRow | null> =>
  (await tx<StoryBlockRow[]>`select b.id, b.name, b.content, b.revision, b.updated_at, ${usedOn(tx)} as products from story_block b where b.id = ${id} and b.store_id = ${storeId}`)[0] ?? null

export const countStoryBlocks = async (tx: ScopedSql, storeId: string): Promise<number> =>
  (await tx<{ n: number }[]>`select count(*)::int as n from story_block where store_id = ${storeId}`)[0]?.n ?? 0

export const insertStoryBlock = async (tx: ScopedSql, storeId: string, id: string, name: string, content: StoryBlockRow['content']): Promise<void> => {
  await tx`insert into story_block (id, store_id, name, content) values (${id}, ${storeId}, ${name}, ${doc(tx, content)})`
}

export const updateStoryBlock = async (tx: ScopedSql, storeId: string, id: string, revision: number, name: string, content: StoryBlockRow['content'], now: Date): Promise<boolean> =>
  (
    await tx`
      update story_block set name = ${name}, content = ${doc(tx, content)}, updated_at = ${now}, revision = revision + 1
      where id = ${id} and store_id = ${storeId} and revision = ${revision} returning id
    `
  ).length === 1

/** Refused while any story shows it, counting trashed products too, since restoring one would break it. */
export const deleteStoryBlock = async (tx: ScopedSql, storeId: string, id: string): Promise<{ name: string } | 'in_use' | null> => {
  const [block] = await tx<{ name: string }[]>`select name from story_block where id = ${id} and store_id = ${storeId} for update`
  if (!block) return null
  // A statement of its own, so it sees a story saved while this waited for the lock (migration 0045).
  const [use] = await tx<{ used: boolean }[]>`select exists (select 1 from product_story where block_ids @> array[${id}::uuid]) as used`
  if (use?.used) return 'in_use'
  await tx`delete from story_block where id = ${id} and store_id = ${storeId}`
  return { name: block.name }
}
