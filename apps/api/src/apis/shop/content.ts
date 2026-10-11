import { GraphQLError } from 'graphql'
import type { Page } from '#core/paging'
import { contentPath, createShopContent, type ShopContentBlock, type ShopContentView } from '#engine/modules/content/index'
import { shopOf, type ShopContext } from './access'
import type { ShopBuilder } from './builder'
import { imageOf } from './catalog'

// Content pages and the blog as a storefront reads them (FIRST-RELEASE §19 Shop API; storefront ARCHITECTURE §3.1):
// what is live, in the shopper's language, cursor-paged and edge-cached with the catalogue.

const contentOf = (ctx: ShopContext) => {
  const { sql, shopper } = shopOf(ctx)
  return createShopContent({ sql, context: shopper.context, language: shopper.language, now: ctx.now })
}

type Question = { question: string; answer: string }
const field = <K extends string>(b: ShopContentBlock, key: K): unknown => (key in b ? (b as Record<K, unknown>)[key] : null)

export const registerContent = ({ builder, pageInfo, image }: ShopBuilder) => {
  const QuestionType = builder.objectRef<Question>('ShopContentQuestion').implement({
    fields: (t) => ({ question: t.exposeString('question'), answer: t.exposeString('answer') }),
  })
  const BlockType = builder.objectRef<ShopContentBlock>('ShopContentBlock').implement({
    fields: (t) => ({
      // heading, text, image, faq, products, or form (the page's contact form, which the theme places).
      kind: t.exposeString('kind'),
      text: t.string({ nullable: true, resolve: (b) => field(b, 'text') as string | null }),
      image: t.field({ type: image, nullable: true, resolve: (b, _, ctx) => imageOf(ctx, field(b, 'assetId') as string | null) }),
      alt: t.string({ nullable: true, resolve: (b) => field(b, 'alt') as string | null }),
      items: t.field({ type: [QuestionType], nullable: true, resolve: (b) => field(b, 'items') as Question[] | null }),
      // The web addresses of the products still on show, for `product(slug)`: their live price and stock come from there.
      productSlugs: t.stringList({ nullable: true, resolve: (b) => field(b, 'productSlugs') as string[] | null }),
    }),
  })
  const PageType = builder.objectRef<ShopContentView>('ShopContentPage').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      title: t.exposeString('title'),
      slug: t.exposeString('slug'),
      path: t.string({ resolve: (e) => contentPath('page', e.slug) }),
      body: t.field({ type: [BlockType], resolve: (e) => e.body }),
      seoTitle: t.exposeString('seo_title', { nullable: true }),
      seoDescription: t.exposeString('seo_description', { nullable: true }),
      // Shown in the footer menu.
      inMenu: t.exposeBoolean('in_menu'),
      updatedAt: t.string({ resolve: (e) => e.updated_at.toISOString() }),
    }),
  })
  const PostType = builder.objectRef<ShopContentView>('ShopBlogPost').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      title: t.exposeString('title'),
      slug: t.exposeString('slug'),
      path: t.string({ resolve: (e) => contentPath('post', e.slug) }),
      body: t.field({ type: [BlockType], resolve: (e) => e.body }),
      seoTitle: t.exposeString('seo_title', { nullable: true }),
      seoDescription: t.exposeString('seo_description', { nullable: true }),
      publishedAt: t.string({ resolve: (e) => (e.publish_at ?? e.updated_at).toISOString() }),
      author: t.exposeString('author', { nullable: true }),
      tags: t.exposeStringList('tags'),
      cover: t.field({ type: image, nullable: true, resolve: (e, _, ctx) => imageOf(ctx, e.cover_asset_id) }),
    }),
  })
  const PagePage = builder.objectRef<Page<ShopContentView>>('ShopContentPagePage').implement({
    fields: (t) => ({ nodes: t.field({ type: [PageType], resolve: (p) => p.nodes }), pageInfo: t.field({ type: pageInfo, resolve: (p) => p.pageInfo }) }),
  })
  const PostPage = builder.objectRef<Page<ShopContentView>>('ShopBlogPostPage').implement({
    fields: (t) => ({ nodes: t.field({ type: [PostType], resolve: (p) => p.nodes }), pageInfo: t.field({ type: pageInfo, resolve: (p) => p.pageInfo }) }),
  })

  const access = { api: 'shop', scope: 'shop', permission: null } as const
  const paged = <T>(result: { ok: true; value: T } | { ok: false; reason: string }): T => {
    if (!result.ok) throw new GraphQLError('That page cursor isn’t valid.', { extensions: { code: result.reason } })
    return result.value
  }

  builder.queryFields((t) => ({
    // Newest edit first; `inMenu: true` is the footer's pages.
    contentPages: t.field({
      type: PagePage,
      args: { first: t.arg.int(), after: t.arg.string(), before: t.arg.string(), inMenu: t.arg.boolean() },
      extensions: { access },
      resolve: async (_, args, ctx) => paged(await contentOf(ctx).pages(args, args.inMenu ?? null)),
    }),
    contentPage: t.field({ type: PageType, nullable: true, args: { slug: t.arg.string({ required: true }) }, extensions: { access }, resolve: (_, args, ctx) => contentOf(ctx).page(args.slug) }),
    // Newest first by date; none while the store's plan has no blog.
    blogPosts: t.field({
      type: PostPage,
      args: { first: t.arg.int(), after: t.arg.string(), before: t.arg.string(), tag: t.arg.string() },
      extensions: { access },
      resolve: async (_, args, ctx) => paged(await contentOf(ctx).posts(args, args.tag ?? null)),
    }),
    blogPost: t.field({ type: PostType, nullable: true, args: { slug: t.arg.string({ required: true }) }, extensions: { access }, resolve: (_, args, ctx) => contentOf(ctx).post(args.slug) }),
  }))
}
