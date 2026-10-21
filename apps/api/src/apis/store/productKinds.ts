import { GraphQLError } from 'graphql'
import { createKindService, kindsAudit, maxKeysPerSave, type KindRefusal, type KindResult, type ProductKindView } from '#engine/modules/catalog/index'
import { forbidden } from '../graphql/scope'
import { actingCaller, type StoreContext } from './access'
import type { StoreBuilder } from './builder'
import { assetUrl } from './products'

// A download's file or key pool, a service's details and a gift card's expiry (CatEditor; CATALOG-DESIGN T14). The
// merchant side's: these kinds are never a supplier's (decided on #323).

const words: Record<KindRefusal, string> = {
  INVALID_INPUT: 'Something here isn’t valid.',
  NOT_FOUND: 'That product isn’t here any more.',
  WRONG_KIND: 'That isn’t this kind of product. Change what you’re selling first.',
  FILE_REFUSED: 'That file isn’t here. Upload it again.',
  EXPIRY_TOO_SHORT: 'Gift cards must last at least 5 years in the US and 1 year elsewhere.',
  STALE_REVISION: 'Someone else saved this product. Reload to see their changes.',
  READ_ONLY: 'A read-only support session can’t change this store.',
}

const answered = <T>(result: KindResult<T>): T => {
  if (result.ok) return result.value
  throw new GraphQLError(words[result.reason], { extensions: { code: result.reason } })
}

type Download = NonNullable<ProductKindView['download']>

export const registerProductKinds = (builder: StoreBuilder) => {
  const service = (ctx: StoreContext) => {
    if (!ctx.sql) throw forbidden()
    const caller = actingCaller(ctx)
    return createKindService({ sql: ctx.sql, context: caller.context, actor: { id: caller.person.id, partnerId: caller.person.partnerId }, activity: ctx.activity, facts: ctx.facts, now: ctx.now })
  }

  const File = builder.objectRef<NonNullable<Download['file']>>('DownloadFile').implement({
    fields: (t) => ({ id: t.exposeID('id'), mime: t.exposeString('mime'), bytes: t.exposeInt('bytes'), url: t.string({ resolve: (f) => assetUrl(f.id) }) }),
  })
  const DownloadType = builder.objectRef<Download>('DownloadDetails').implement({
    fields: (t) => ({
      // file or keys.
      mode: t.exposeString('mode'),
      file: t.field({ type: File, nullable: true, resolve: (d) => d.file }),
      // How many times a paid order's link works (3, 5 or 10), and for how many days (7, 30 or 365).
      limit: t.exposeInt('limit'),
      days: t.exposeInt('days'),
      // Keys are counted, never shown again once saved.
      keysLeft: t.exposeInt('keysLeft'),
      keysSold: t.exposeInt('keysSold'),
    }),
  })
  const ServiceType = builder.objectRef<NonNullable<ProductKindView['service']>>('ServiceDetails').implement({
    fields: (t) => ({ duration: t.exposeString('duration', { nullable: true }), location: t.exposeString('location', { nullable: true }) }),
  })
  const GiftCardType = builder.objectRef<NonNullable<ProductKindView['giftCard']>>('GiftCardDetails').implement({
    fields: (t) => ({
      // Null: cards never expire.
      expiryMonths: t.exposeInt('expiryMonths', { nullable: true }),
      // The shortest the store's country allows: 60 in the US, 12 elsewhere.
      shortestMonths: t.exposeInt('shortestMonths'),
    }),
  })
  const KindType = builder.objectRef<ProductKindView>('ProductKind').implement({
    fields: (t) => ({
      productId: t.exposeID('productId'),
      productType: t.exposeString('productType'),
      revision: t.exposeInt('revision'),
      download: t.field({ type: DownloadType, nullable: true, resolve: (k) => k.download }),
      service: t.field({ type: ServiceType, nullable: true, resolve: (k) => k.service }),
      giftCard: t.field({ type: GiftCardType, nullable: true, resolve: (k) => k.giftCard }),
    }),
  })

  const DownloadInput = builder.inputType('DownloadDetailsInput', {
    fields: (t) => ({ mode: t.string({ required: true }), fileId: t.id(), limit: t.int({ required: true }), days: t.int({ required: true }) }),
  })
  const ServiceInput = builder.inputType('ServiceDetailsInput', { fields: (t) => ({ duration: t.string(), location: t.string() }) })
  const GiftCardInput = builder.inputType('GiftCardDetailsInput', { fields: (t) => ({ expiryMonths: t.int() }) })
  // Exactly one, the product's own kind.
  const KindInput = builder.inputType('ProductKindInput', {
    fields: (t) => ({ download: t.field({ type: DownloadInput }), service: t.field({ type: ServiceInput }), giftCard: t.field({ type: GiftCardInput }) }),
  })

  const read = { api: 'store', scope: 'store', permission: 'catalog.read', target: 'none' } as const
  const write = { api: 'store', scope: 'store', permission: 'catalog.write', target: 'none' } as const

  builder.queryFields((t) => ({
    productKind: t.field({
      type: KindType,
      nullable: true,
      args: { productId: t.arg.id({ required: true }) },
      extensions: { access: read },
      resolve: (_, args, ctx) => service(ctx).kind(String(args.productId)),
    }),
  }))

  builder.mutationFields((t) => ({
    saveProductKind: t.field({
      type: KindType,
      args: { productId: t.arg.id({ required: true }), revision: t.arg.int({ required: true }), input: t.arg({ type: KindInput, required: true }) },
      extensions: { access: { ...write, audit: kindsAudit.saved } },
      resolve: async (_, args, ctx) => {
        const { download, service: details, giftCard } = args.input
        return answered(await service(ctx).save(String(args.productId), args.revision, { download: download ? { ...download, fileId: download.fileId === null || download.fileId === undefined ? null : String(download.fileId) } : null, service: details, giftCard }))
      },
    }),
    // One key a line, up to 1,000 at a time; a key already in the pool is skipped.
    addLicenceKeys: t.field({
      type: KindType,
      args: { productId: t.arg.id({ required: true }), keys: t.arg.stringList({ required: true }) },
      extensions: { access: { ...write, audit: kindsAudit.keysAdded } },
      resolve: async (_, args, ctx) => {
        if (args.keys.length > maxKeysPerSave) throw new GraphQLError(words.INVALID_INPUT, { extensions: { code: 'INVALID_INPUT' } })
        return answered(await service(ctx).addKeys(String(args.productId), args.keys))
      },
    }),
  }))
}
