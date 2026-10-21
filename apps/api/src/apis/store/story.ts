import { GraphQLError } from 'graphql'
import { pageOf } from '#core/paging'
import { createStoryService, storyAudit, type Story, type StoryModule, type StoryRefusal, type StoryResult } from '#engine/modules/catalog/index'
import { forbidden } from '../graphql/scope'
import { actingCaller, type StoreContext } from './access'
import { pageInfoType, type StoreBuilder } from './builder'
import { requireFeature } from './listing'
import { storePage } from './refusals'

// A+ content (CATALOG Q; FIRST-RELEASE §12, §19). Writing it needs the plan's `aplus`; reading never does,
// so content kept through a downgrade still opens (Q12).

const words: Record<StoryRefusal['reason'], string> = {
  INVALID_STORY: 'Something in this A+ content isn’t valid.',
  NOT_FOUND: 'That isn’t here any more.',
  STALE_REVISION: 'Someone else saved this. Reload to see their changes.',
  STORY_REFUSED: 'A photo, product or brand story here isn’t one this product can use.',
  STORY_INCOMPLETE: 'Finish the highlighted modules before publishing.',
  TOO_MANY_STORY_BLOCKS: 'A store can have up to 50 brand stories. Remove one first.',
  STORY_BLOCK_IN_USE: 'Products still show this brand story. Remove it from them first.',
}

const answered = <T>(result: StoryResult<T>): T => {
  if (result.ok) return result.value
  const facts = result.reason === 'STALE_REVISION' ? { revision: result.revision } : result.reason === 'INVALID_STORY' ? { field: result.field } : result.reason === 'STORY_INCOMPLETE' ? { gaps: result.gaps } : {}
  throw new GraphQLError(words[result.reason], { extensions: { code: result.reason, ...facts } })
}

type Photo = { assetId: string | null; alt: string | null }
type Item = { title: string | null; text: string | null; photo: Photo | null }
const field = <K extends string>(m: StoryModule, key: K): unknown => (key in m ? (m as Record<K, unknown>)[key] : null)

export const registerStory = (builder: StoreBuilder) => {
  const PageInfo = pageInfoType(builder)
  const service = (ctx: StoreContext) => {
    if (!ctx.sql) throw forbidden()
    const caller = actingCaller(ctx)
    return createStoryService({ sql: ctx.sql, context: caller.context, actor: { id: caller.person.id, partnerId: caller.person.partnerId }, activity: ctx.activity, facts: ctx.facts, now: ctx.now })
  }

  const PhotoType = builder.objectRef<Photo>('StoryPhoto').implement({
    fields: (t) => ({ assetId: t.exposeID('assetId', { nullable: true }), alt: t.exposeString('alt', { nullable: true }) }),
  })
  const ItemType = builder.objectRef<Item>('StoryItem').implement({
    fields: (t) => ({ title: t.exposeString('title', { nullable: true }), text: t.exposeString('text', { nullable: true }), photo: t.field({ type: PhotoType, nullable: true, resolve: (i) => i.photo }) }),
  })
  const VideoType = builder.objectRef<{ assetId: string | null; url: string | null }>('StoryVideo').implement({
    fields: (t) => ({ assetId: t.exposeID('assetId', { nullable: true }), url: t.exposeString('url', { nullable: true }) }),
  })
  // One shape for every kind: a field the kind doesn't have is null (CatAPlus).
  const ModuleType = builder.objectRef<StoryModule>('StoryModule').implement({
    fields: (t) => ({
      id: t.exposeString('id'),
      kind: t.exposeString('kind'),
      title: t.string({ nullable: true, resolve: (m) => field(m, 'title') as string | null }),
      body: t.string({ nullable: true, resolve: (m) => field(m, 'body') as string | null }),
      side: t.string({ nullable: true, resolve: (m) => field(m, 'side') as string | null }),
      photo: t.field({ type: PhotoType, nullable: true, resolve: (m) => field(m, 'photo') as Photo | null }),
      items: t.field({ type: [ItemType], nullable: true, resolve: (m) => field(m, 'items') as Item[] | null }),
      photos: t.field({ type: [PhotoType], nullable: true, resolve: (m) => field(m, 'photos') as Photo[] | null }),
      productIds: t.idList({ nullable: true, resolve: (m) => field(m, 'productIds') as string[] | null }),
      blockId: t.id({ nullable: true, resolve: (m) => field(m, 'blockId') as string | null }),
      video: t.field({ type: VideoType, nullable: true, resolve: (m) => field(m, 'video') as { assetId: string | null; url: string | null } | null }),
    }),
  })
  const StoryProduct = builder.objectRef<{ id: string; name: string }>('StoryProduct').implement({ fields: (t) => ({ id: t.exposeID('id'), name: t.exposeString('name') }) })
  const StoryType = builder.objectRef<Story>('ProductStory').implement({
    fields: (t) => ({
      productId: t.exposeID('productId'),
      template: t.exposeString('template', { nullable: true }),
      modules: t.field({ type: [ModuleType], resolve: (s) => s.modules }),
      // 'draft' (never published), 'live' (the page shows this draft) or 'changed' (the draft differs from the page).
      status: t.exposeString('status'),
      publishedAt: t.string({ nullable: true, resolve: (s) => s.publishedAt?.toISOString() ?? null }),
      revision: t.exposeInt('revision'),
      products: t.field({ type: [StoryProduct], resolve: (s) => s.products }),
    }),
  })
  type BlockSummary = { id: string; name: string; products: number; updated_at: Date }
  type Block = BlockSummary & { content: { title: string; body: string; photo: Photo | null }; revision: number }
  const BlockSummaryType = builder.objectRef<BlockSummary>('StoryBlockSummary').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      name: t.exposeString('name'),
      // "Used on 48 products" (Q5).
      products: t.exposeInt('products'),
      updatedAt: t.string({ resolve: (b) => b.updated_at.toISOString() }),
    }),
  })
  const BlockPage = builder.objectRef<{ nodes: BlockSummary[]; pageInfo: { startCursor: string | null; endCursor: string | null; hasPreviousPage: boolean; hasNextPage: boolean } }>('StoryBlockPage').implement({
    fields: (t) => ({ nodes: t.field({ type: [BlockSummaryType], resolve: (p) => p.nodes }), pageInfo: t.field({ type: PageInfo, resolve: (p) => p.pageInfo }) }),
  })
  const BlockType = builder.objectRef<Block>('StoryBlock').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      name: t.exposeString('name'),
      title: t.string({ resolve: (b) => b.content.title }),
      body: t.string({ resolve: (b) => b.content.body }),
      photo: t.field({ type: PhotoType, nullable: true, resolve: (b) => b.content.photo }),
      products: t.exposeInt('products'),
      revision: t.exposeInt('revision'),
      updatedAt: t.string({ resolve: (b) => b.updated_at.toISOString() }),
    }),
  })
  const SavedBlock = builder.objectRef<{ id: string; revision: number }>('SavedStoryBlock').implement({ fields: (t) => ({ id: t.exposeID('id'), revision: t.exposeInt('revision') }) })

  const PhotoInput = builder.inputType('StoryPhotoInput', { fields: (t) => ({ assetId: t.id(), alt: t.string() }) })
  const ItemInput = builder.inputType('StoryItemInput', { fields: (t) => ({ title: t.string(), text: t.string(), photo: t.field({ type: PhotoInput }) }) })
  const VideoInput = builder.inputType('StoryVideoInput', { fields: (t) => ({ assetId: t.id(), url: t.string() }) })
  const ModuleInput = builder.inputType('StoryModuleInput', {
    fields: (t) => ({
      id: t.string({ required: true }),
      kind: t.string({ required: true }),
      title: t.string(),
      body: t.string(),
      side: t.string(),
      photo: t.field({ type: PhotoInput }),
      items: t.field({ type: [ItemInput] }),
      photos: t.field({ type: [PhotoInput] }),
      productIds: t.idList(),
      blockId: t.id(),
      video: t.field({ type: VideoInput }),
    }),
  })
  const StoryInput = builder.inputType('ProductStoryInput', { fields: (t) => ({ template: t.string(), modules: t.field({ type: [ModuleInput], required: true }) }) })
  const BlockInput = builder.inputType('StoryBlockInput', {
    fields: (t) => ({ name: t.string({ required: true }), title: t.string({ required: true }), body: t.string({ required: true }), photo: t.field({ type: PhotoInput }) }),
  })

  const read = { api: 'store', scope: 'store-seller', permission: 'catalog.read', target: 'none' } as const
  const write = { api: 'store', scope: 'store-seller', permission: 'catalog.write', target: 'none' } as const
  // Brand stories are the merchant side's: a supplier has no brand module (Q5).
  const blockRead = { api: 'store', scope: 'store', permission: 'catalog.read', target: 'none' } as const
  const blockWrite = { api: 'store', scope: 'store', permission: 'catalog.write', target: 'none' } as const
  const ids = (values: readonly (string | number)[]) => values.map(String)

  builder.queryFields((t) => ({
    productStory: t.field({
      type: StoryType,
      nullable: true,
      args: { productId: t.arg.id({ required: true }) },
      extensions: { access: read },
      resolve: (_, args, ctx) => service(ctx).story(String(args.productId)),
    }),
    storyBlocks: t.field({
      type: BlockPage,
      args: { first: t.arg.int(), after: t.arg.string(), before: t.arg.string() },
      extensions: { access: blockRead },
      resolve: async (_, args, ctx) => {
        const window = storePage(args)
        return pageOf(await service(ctx).blocks(window), window, (b) => ({ occurredAt: b.updated_at, id: b.id }))
      },
    }),
    storyBlock: t.field({
      type: BlockType,
      nullable: true,
      args: { id: t.arg.id({ required: true }) },
      extensions: { access: blockRead },
      resolve: (_, args, ctx) => service(ctx).block(String(args.id)),
    }),
  }))

  builder.mutationFields((t) => ({
    // Revision 0 is the first save of a product's story.
    saveProductStory: t.field({
      type: StoryType,
      args: { productId: t.arg.id({ required: true }), revision: t.arg.int({ required: true }), input: t.arg({ type: StoryInput, required: true }) },
      extensions: { access: { ...write, audit: storyAudit.saved } },
      resolve: async (_, args, ctx) => {
        await requireFeature(ctx, actingCaller(ctx), 'aplus')
        return answered(await service(ctx).save(String(args.productId), args.revision, args.input))
      },
    }),
    publishProductStory: t.field({
      type: StoryType,
      args: { productId: t.arg.id({ required: true }), revision: t.arg.int({ required: true }) },
      extensions: { access: { ...write, audit: storyAudit.published } },
      resolve: async (_, args, ctx) => {
        await requireFeature(ctx, actingCaller(ctx), 'aplus')
        return answered(await service(ctx).publish(String(args.productId), args.revision))
      },
    }),
    copyProductStory: t.int({
      args: { fromProductId: t.arg.id({ required: true }), toProductIds: t.arg.idList({ required: true }) },
      extensions: { access: { ...write, audit: storyAudit.copied } },
      resolve: async (_, args, ctx) => {
        await requireFeature(ctx, actingCaller(ctx), 'aplus')
        return answered(await service(ctx).copy(String(args.fromProductId), ids(args.toProductIds)))
      },
    }),
    saveStoryBlock: t.field({
      type: SavedBlock,
      args: { id: t.arg.id(), revision: t.arg.int(), input: t.arg({ type: BlockInput, required: true }) },
      extensions: { access: { ...blockWrite, audit: storyAudit.blockSaved } },
      resolve: async (_, args, ctx) => {
        await requireFeature(ctx, actingCaller(ctx), 'aplus')
        return answered(await service(ctx).saveBlock(args.id === null || args.id === undefined ? null : String(args.id), args.revision ?? null, args.input))
      },
    }),
    deleteStoryBlock: t.boolean({
      args: { id: t.arg.id({ required: true }) },
      extensions: { access: { ...blockWrite, audit: storyAudit.blockDeleted } },
      resolve: async (_, args, ctx) => answered(await service(ctx).removeBlock(String(args.id))),
    }),
  }))
}
