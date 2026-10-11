import { GraphQLError } from 'graphql'
import { pageOf } from '#core/paging'
import { contentAudit, contentPath, createContentService, type ContentBlock, type ContentKind, type ContentRefusal, type ContentResult, type ContentRow } from '#engine/modules/content/index'
import { forbidden } from '../graphql/scope'
import { actingCaller, type StoreContext } from './access'
import { pageInfoType, type StoreBuilder } from './builder'
import { requirePlan, storePage } from './refusals'

// Storefront › Pages and Journal (StorefrontContent; FIRST-RELEASE §14): the Owner writes (`publish`), the Manager
// reads (`storefront.read`). A post needs the plan's `blog` (SAAS §6.1).

const words: Record<ContentRefusal['reason'], string> = {
  INVALID_INPUT: 'Something here isn’t valid.',
  NOT_FOUND: 'That isn’t here any more.',
  STALE_REVISION: 'Someone else saved this. Reload to see their changes.',
  PATH_TAKEN: 'That web address is already used on your shop. Change the web address.',
}

const answered = <T>(result: ContentResult<T>): T => {
  if (result.ok) return result.value
  const facts = result.reason === 'STALE_REVISION' ? { revision: result.revision } : result.reason === 'INVALID_INPUT' ? { field: result.field } : result.reason === 'PATH_TAKEN' ? { path: result.path, heldBy: result.heldBy } : {}
  throw new GraphQLError(words[result.reason], { extensions: { code: result.reason, ...facts } })
}

type Question = { question: string; answer: string }
const field = <K extends string>(b: ContentBlock, key: K): unknown => (key in b ? (b as Record<K, unknown>)[key] : null)

export const registerContent = (builder: StoreBuilder) => {
  const PageInfo = pageInfoType(builder)
  const service = (ctx: StoreContext) => {
    if (!ctx.sql) throw forbidden()
    const caller = actingCaller(ctx)
    return createContentService({ sql: ctx.sql, context: caller.context, actor: { id: caller.person.id, partnerId: caller.person.partnerId }, activity: ctx.activity, facts: ctx.facts, now: ctx.now })
  }

  const QuestionType = builder.objectRef<Question>('ContentQuestion').implement({
    fields: (t) => ({ question: t.exposeString('question'), answer: t.exposeString('answer') }),
  })
  // One shape for every kind: a field the kind doesn't have is null (StorefrontContent's blocks).
  const BlockType = builder.objectRef<ContentBlock>('ContentBlock').implement({
    fields: (t) => ({
      // heading, text, image, faq, products, or form (a page's contact form).
      kind: t.exposeString('kind'),
      text: t.string({ nullable: true, resolve: (b) => field(b, 'text') as string | null }),
      assetId: t.id({ nullable: true, resolve: (b) => field(b, 'assetId') as string | null }),
      alt: t.string({ nullable: true, resolve: (b) => field(b, 'alt') as string | null }),
      items: t.field({ type: [QuestionType], nullable: true, resolve: (b) => field(b, 'items') as Question[] | null }),
      productIds: t.idList({ nullable: true, resolve: (b) => field(b, 'productIds') as string[] | null }),
    }),
  })
  const EntryType = builder.objectRef<ContentRow>('ContentEntry').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      // page or post
      kind: t.exposeString('kind'),
      title: t.exposeString('title'),
      slug: t.exposeString('slug'),
      // Where it lives on the shop: /{slug} for a page, /blog/{slug} for a post (storefront ARCHITECTURE §3.1).
      path: t.string({ resolve: (e) => contentPath(e.kind, e.slug) }),
      // draft, scheduled (a post dated later) or published.
      status: t.exposeString('status'),
      body: t.field({ type: [BlockType], resolve: (e) => e.body as ContentBlock[] }),
      seoTitle: t.exposeString('seo_title', { nullable: true }),
      seoDescription: t.exposeString('seo_description', { nullable: true }),
      inMenu: t.exposeBoolean('in_menu'),
      publishAt: t.string({ nullable: true, resolve: (e) => e.publish_at?.toISOString() ?? null }),
      author: t.exposeString('author', { nullable: true }),
      tags: t.exposeStringList('tags'),
      coverAssetId: t.exposeID('cover_asset_id', { nullable: true }),
      // Changed since the live site was built: "Goes live with your shop's next publish".
      waitingForPublish: t.exposeBoolean('waiting'),
      revision: t.exposeInt('revision'),
      updatedAt: t.string({ resolve: (e) => e.updated_at.toISOString() }),
    }),
  })
  const EntryPage = builder.objectRef<{ nodes: ContentRow[]; pageInfo: { startCursor: string | null; endCursor: string | null; hasPreviousPage: boolean; hasNextPage: boolean } }>('ContentEntryPage').implement({
    fields: (t) => ({ nodes: t.field({ type: [EntryType], resolve: (p) => p.nodes }), pageInfo: t.field({ type: PageInfo, resolve: (p) => p.pageInfo }) }),
  })

  const QuestionInput = builder.inputType('ContentQuestionInput', { fields: (t) => ({ question: t.string({ required: true }), answer: t.string({ required: true }) }) })
  const BlockInput = builder.inputType('ContentBlockInput', {
    fields: (t) => ({ kind: t.string({ required: true }), text: t.string(), assetId: t.id(), alt: t.string(), items: t.field({ type: [QuestionInput] }), productIds: t.idList() }),
  })
  const PageInput = builder.inputType('ContentPageInput', {
    fields: (t) => ({
      title: t.string({ required: true }),
      // Left out, the title makes it ("Caring for linen" is caring-for-linen).
      slug: t.string(),
      body: t.field({ type: [BlockInput], required: true }),
      seoTitle: t.string(),
      seoDescription: t.string(),
      // false saves a draft, off the shop.
      publish: t.boolean({ required: true }),
      inMenu: t.boolean(),
    }),
  })
  const PostInput = builder.inputType('BlogPostInput', {
    fields: (t) => ({
      title: t.string({ required: true }),
      slug: t.string(),
      body: t.field({ type: [BlockInput], required: true }),
      seoTitle: t.string(),
      seoDescription: t.string(),
      // Published with a later date, it is scheduled and goes live then.
      publish: t.boolean({ required: true }),
      publishAt: t.string(),
      author: t.string(),
      tags: t.stringList(),
      coverAssetId: t.id(),
    }),
  })

  const read = { api: 'store', scope: 'store', permission: 'storefront.read', target: 'none' } as const
  const write = { api: 'store', scope: 'store', permission: 'publish', target: 'none' } as const
  const idOf = (id: string | number | null | undefined) => (id === null || id === undefined ? null : String(id))
  // A block's absent fields arrive as null from GraphQL; the engine's schema takes only the kind's own.
  const blocksOf = (body: readonly Record<string, unknown>[]) => body.map((b) => Object.fromEntries(Object.entries(b).filter(([, v]) => v !== null && v !== undefined)))
  const inputOf = (input: Record<string, unknown> & { body: readonly Record<string, unknown>[] }) => ({ ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== null && v !== undefined)), body: blocksOf(input.body) })
  const requireBlog = async (ctx: StoreContext) => {
    if (!ctx.sql) throw forbidden()
    await requirePlan(ctx.sql, actingCaller(ctx).context, { key: 'blog' }, ctx.now())
  }

  builder.queryFields((t) => {
    const list = (kind: ContentKind) =>
      t.field({
        type: EntryPage,
        args: { first: t.arg.int(), after: t.arg.string(), before: t.arg.string() },
        extensions: { access: read },
        resolve: async (_, args, ctx) => {
          const window = storePage(args)
          return pageOf(await service(ctx).list(kind, window), window, (e) => ({ occurredAt: (kind === 'post' ? e.publish_at : null) ?? e.updated_at, id: e.id }))
        },
      })
    return {
      // Pages by when they were edited, posts by their date; newest first.
      contentPages: list('page'),
      blogPosts: list('post'),
      contentEntry: t.field({ type: EntryType, nullable: true, args: { id: t.arg.id({ required: true }) }, extensions: { access: read }, resolve: (_, args, ctx) => service(ctx).get(String(args.id)) }),
      // The theme's own pages, which the Pages tab lists to open in the studio (decided on #338).
      customPagePaths: t.stringList({ extensions: { access: read }, resolve: (_, __, ctx) => service(ctx).customPaths() }),
    }
  })

  builder.mutationFields((t) => ({
    // Revision is the one read; left out with no id, it creates.
    saveContentPage: t.field({
      type: EntryType,
      args: { id: t.arg.id(), revision: t.arg.int(), input: t.arg({ type: PageInput, required: true }) },
      extensions: { access: { ...write, audit: contentAudit.saved.page } },
      resolve: async (_, args, ctx) => answered(await service(ctx).save('page', idOf(args.id), args.revision ?? null, inputOf(args.input))),
    }),
    deleteContentPage: t.boolean({
      args: { id: t.arg.id({ required: true }) },
      extensions: { access: { ...write, audit: contentAudit.deleted.page } },
      resolve: async (_, args, ctx) => answered(await service(ctx).remove('page', String(args.id))),
    }),
    saveBlogPost: t.field({
      type: EntryType,
      args: { id: t.arg.id(), revision: t.arg.int(), input: t.arg({ type: PostInput, required: true }) },
      extensions: { access: { ...write, audit: contentAudit.saved.post } },
      resolve: async (_, args, ctx) => {
        await requireBlog(ctx)
        return answered(await service(ctx).save('post', idOf(args.id), args.revision ?? null, inputOf(args.input)))
      },
    }),
    // Deleting needs no plan: a post kept through a downgrade can still be taken off (SAAS §6.2).
    deleteBlogPost: t.boolean({
      args: { id: t.arg.id({ required: true }) },
      extensions: { access: { ...write, audit: contentAudit.deleted.post } },
      resolve: async (_, args, ctx) => answered(await service(ctx).remove('post', String(args.id))),
    }),
  }))
}
