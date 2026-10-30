import { GraphQLError } from 'graphql'
import { decodeCursor, encodeCursor } from '#core/cursor'
import { createAssetService } from '#engine/modules/catalog/index'
import type { LibraryAsset } from '#db/scoped/catalog'
import { withSystemScope } from '#db/scoped/index'
import { selectRepoHead } from '#db/scoped/storefronts'
import { forbidden } from '../graphql/scope'
import { actingCaller, type StoreContext } from './access'
import type { StoreBuilder } from './builder'
import { designWrite } from './storefront'

// Storefront › Assets (docs/storefront/AI-STUDIO.md §8): the merchant's own images and videos, which the studio picks from.
// `storefront.read` looks, `publish` (the Owner) renames and deletes; uploading is `POST /api/assets` as everywhere.

const pageSize = 48
const maxSearch = 100
const maxName = 120
const reads = { api: 'store', scope: 'store', permission: 'storefront.read', target: 'none', blockedFor: ['support', 'impersonation'] } as const

const assetsFor = (ctx: StoreContext) => {
  if (!ctx.sql || !ctx.files) throw forbidden()
  const caller = actingCaller(ctx)
  return createAssetService({ sql: ctx.sql, context: caller.context, actor: { id: caller.person.id, partnerId: caller.person.partnerId }, activity: ctx.activity, facts: ctx.facts, store: ctx.files, siteText: siteTextOf(ctx) })
}

const siteTextOf = (ctx: StoreContext) => async (): Promise<string | null> => {
  const sql = ctx.sql
  const repos = (await ctx.siteRepos?.()) ?? null
  const caller = actingCaller(ctx)
  if (!sql || !repos) return null
  const at = await withSystemScope(sql, (tx) => selectRepoHead(tx, caller.context.storeId))
  return at ? repos.themeText(at.repo, at.head).catch(() => null) : null
}

const refuse = (code: string, message: string) => new GraphQLError(message, { extensions: { code } })

export const registerAssetLibrary = (builder: StoreBuilder) => {
  const Asset = builder.objectRef<LibraryAsset>('LibraryAsset').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      kind: t.exposeString('kind'),
      mime: t.exposeString('mime'),
      bytes: t.exposeInt('bytes'),
      width: t.exposeInt('width', { nullable: true }),
      height: t.exposeInt('height', { nullable: true }),
      name: t.exposeString('name', { nullable: true }),
      uses: t.exposeInt('uses'),
      createdAt: t.string({ resolve: (a) => a.created_at.toISOString() }),
    }),
  })
  const Page = builder.objectRef<{ assets: LibraryAsset[]; next: string | null }>('LibraryPage').implement({
    fields: (t) => ({ assets: t.field({ type: [Asset], resolve: (p) => p.assets }), next: t.string({ nullable: true, resolve: (p) => p.next }) }),
  })

  builder.queryFields((t) => ({
    libraryAssets: t.field({
      type: Page,
      args: { after: t.arg.string(), kind: t.arg.string(), search: t.arg.string() },
      extensions: { access: reads },
      resolve: async (_, args, ctx: StoreContext) => {
        const cursor = args.after ? decodeCursor(args.after) : null
        if (args.after && !cursor) throw refuse('INVALID_INPUT', 'Something here isn’t valid.')
        const search = args.search?.trim().slice(0, maxSearch) || null
        const kind = args.kind === 'image' || args.kind === 'video' ? args.kind : null
        const found = await assetsFor(ctx).library({ limit: pageSize + 1, before: cursor ? { at: cursor.occurredAt, id: cursor.id } : null, kind, search })
        const assets = found.slice(0, pageSize)
        const last = assets.at(-1)
        return { assets, next: found.length > pageSize && last ? encodeCursor({ occurredAt: last.created_at, id: last.id }) : null }
      },
    }),
  }))

  builder.mutationFields((t) => ({
    renameLibraryAsset: t.boolean({
      args: { id: t.arg.id({ required: true }), name: t.arg.string({ required: true }) },
      extensions: { access: designWrite('asset.renamed') },
      resolve: async (_, args, ctx: StoreContext) => {
        const name = args.name.trim()
        if (name.length > maxName) throw refuse('INVALID_INPUT', 'Something here isn’t valid.')
        if (!(await assetsFor(ctx).rename(String(args.id), name === '' ? null : name))) throw refuse('NOT_FOUND', 'That isn’t here any more.')
        return true
      },
    }),
    deleteLibraryAsset: t.boolean({
      args: { id: t.arg.id({ required: true }) },
      extensions: { access: designWrite('asset.deleted') },
      resolve: async (_, args, ctx: StoreContext) => {
        const done = await assetsFor(ctx).remove(String(args.id))
        if (done === 'missing') throw refuse('NOT_FOUND', 'That isn’t here any more.')
        if (done === 'in_use') throw refuse('ASSET_IN_USE', 'This file is used on your site. Remove it from there first.')
        return true
      },
    }),
  }))
}
