import { createStudioService, designAudit, type AskAnswer, type StudioSessionView, type TextEntry } from '#saas/ai-designer/index'
import type { MessageRow } from '#db/scoped/design'
import type { StockPhoto } from '#integrations/stockImages/pixabay'
import { decodeCursor, encodeCursor } from '#core/cursor'
import { standingPerson } from '#auth/storeCaller'
import { endStudioSession } from '#saas/studio/index'
import { forbidden } from '../graphql/scope'
import { actingCaller, type StoreContext } from './access'
import type { StoreBuilder } from './builder'
import { answered, designWrite } from './storefront'

// The AI studio (PortalStorefront's studio; FIRST-RELEASE §14, §19; storefront AI-STUDIO §3–§5): the Owner changes the
// draft, the Manager opens the studio read-only and reads the chat; a support or staff session does neither.

const studioFor = (ctx: StoreContext) => {
  if (!ctx.sql) throw forbidden()
  const caller = actingCaller(ctx)
  const design = ctx.design ?? null
  return createStudioService({
    sql: ctx.sql,
    context: caller.context,
    actor: { id: caller.person.id, partnerId: caller.person.partnerId },
    activity: ctx.activity,
    facts: ctx.facts,
    studio: ctx.studio?.(caller.context) ?? null,
    role: caller.role,
    ai: design?.ai ?? (() => null),
    models: design?.models ?? (() => []),
    screenshots: design?.screenshots ?? null,
    lookup: ctx.lookup ?? null,
    assets: ctx.files ?? null,
    readAsset: design?.readAsset ?? null,
    stock: design?.stock ?? null,
    allowStock: ctx.allowStock ?? (async () => false),
    previewDomain: ctx.preview?.domain ?? null,
    shopDomain: ctx.domains?.shopDomain ?? null,
    now: ctx.now,
  })
}

const read = { api: 'store', scope: 'store', permission: 'storefront.read', target: 'none', blockedFor: ['support', 'impersonation'] } as const
const chatPage = 50

export const registerStudio = (builder: StoreBuilder) => {
  const Session = builder.objectRef<StudioSessionView>('StudioSession').implement({
    fields: (t) => ({
      // starting, queued, ready, busy (another tab's change) or unavailable.
      state: t.exposeString('state'),
      place: t.int({ nullable: true, resolve: (s) => (s.state === 'queued' ? s.place : null) }),
      // The studio-session id the frame's path carries; renewed with renewStudioSession.
      session: t.exposeString('session'),
      // The models this store's AI account can run, the default first; empty when the merchant has no choice.
      models: t.exposeStringList('models'),
      // https://{slug}-preview.<SHOP_DOMAIN>/__studio/{session}/, never the portal host.
      frameUrl: t.exposeString('frameUrl'),
      // change (the Owner) or view (a Manager).
      access: t.exposeString('access'),
      expiresAt: t.string({ resolve: (s) => s.expiresAt.toISOString() }),
    }),
  })
  const Message = builder.objectRef<MessageRow>('DesignMessage').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      // user, ai, note or error. A note's and an error's text is a code the portal words (`template:linen`, `undone`).
      role: t.exposeString('role'),
      text: t.exposeString('text'),
      changed: t.exposeStringList('changed'),
      imageAssetId: t.exposeID('image_asset_id', { nullable: true }),
      sampleUrl: t.exposeString('sample_url', { nullable: true }),
      // The page the reply shows.
      page: t.exposeString('page', { nullable: true }),
      // A change the latest of which "Undo this change" takes back.
      canUndo: t.boolean({ resolve: (m) => m.role === 'ai' && m.commit !== null && !m.undone }),
      undone: t.exposeBoolean('undone'),
      createdAt: t.string({ resolve: (m) => m.created_at.toISOString() }),
    }),
  })
  const Chat = builder.objectRef<{ messages: MessageRow[]; next: string | null }>('DesignChat').implement({
    fields: (t) => ({
      // Newest first.
      messages: t.field({ type: [Message], resolve: (c) => c.messages }),
      next: t.exposeString('next', { nullable: true }),
    }),
  })
  const Answer = builder.objectRef<AskAnswer>('DesignAnswer').implement({
    fields: (t) => ({
      // changed, unchanged (asked for nothing the theme holds, or declined), refused (failed the checks) or failed.
      outcome: t.exposeString('outcome'),
      message: t.field({ type: Message, resolve: (a) => a.message }),
    }),
  })
  const StockPhotoRef = builder.objectRef<StockPhoto>('StockPhoto').implement({
    fields: (t) => ({ id: t.exposeString('id'), thumb: t.exposeString('thumb'), user: t.exposeString('user'), pageUrl: t.exposeString('pageUrl'), tags: t.exposeString('tags') }),
  })
  const Text = builder.objectRef<TextEntry>('DesignText').implement({
    fields: (t) => ({ key: t.exposeString('key'), text: t.exposeString('text') }),
  })

  builder.queryFields((t) => ({
    studioSession: t.field({
      type: Session,
      args: { session: t.arg.string() },
      extensions: { access: read },
      resolve: async (_, args, ctx: StoreContext) => answered(await studioFor(ctx).session(args.session ?? null)),
    }),
    designChat: t.field({
      type: Chat,
      args: { after: t.arg.string() },
      extensions: { access: read },
      resolve: async (_, args, ctx: StoreContext) => {
        const cursor = args.after ? decodeCursor(args.after) : null
        const before = cursor ? { at: cursor.occurredAt, id: cursor.id } : null
        const messages = await studioFor(ctx).chat(chatPage + 1, before)
        const page = messages.slice(0, chatPage)
        const last = page.at(-1)
        return { messages: page, next: messages.length > chatPage && last ? encodeCursor({ occurredAt: last.created_at, id: last.id }) : null }
      },
    }),
    stockImagesAvailable: t.boolean({
      extensions: { access: read },
      resolve: async (_, __, ctx: StoreContext) => ctx.design?.stock != null,
    }),
    searchStockImages: t.field({
      type: [StockPhotoRef],
      args: { query: t.arg.string({ required: true }), page: t.arg.int({ required: true }) },
      extensions: { access: { api: 'store', scope: 'store', permission: 'publish', target: 'none', blockedFor: ['support', 'impersonation'] } },
      resolve: async (_, args, ctx: StoreContext) => answered(await studioFor(ctx).stockSearch(args.query, args.page)).photos,
    }),
    designText: t.field({
      type: [Text],
      args: { page: t.arg.string({ required: true }), locale: t.arg.string({ required: true }) },
      extensions: { access: read },
      resolve: async (_, args, ctx: StoreContext) => answered(await studioFor(ctx).texts(args.page, args.locale)),
    }),
  }))

  builder.mutationFields((t) => ({
    askDesign: t.field({
      type: Answer,
      args: { text: t.arg.string({ required: true }), model: t.arg.string(), imageAssetId: t.arg.id(), sampleUrl: t.arg.string(), page: t.arg.string({ required: true }), device: t.arg.string({ required: true }), mode: t.arg.string() },
      extensions: { access: designWrite(designAudit.designRequested) },
      resolve: async (_, args, ctx: StoreContext) => {
        const device = args.device === 'phone' || args.device === 'tablet' ? args.device : 'desktop'
        return answered(await studioFor(ctx).ask({ text: args.text, model: args.model ?? null, imageAssetId: args.imageAssetId ?? null, sampleUrl: args.sampleUrl ?? null, page: args.page, device, mode: args.mode === 'chat' ? 'chat' : 'change' }))
      },
    }),
    cancelDesign: t.boolean({
      extensions: { access: designWrite(designAudit.designStopped) },
      resolve: async (_, __, ctx: StoreContext) => answered(await studioFor(ctx).cancel()),
    }),
    useStockImage: t.id({
      args: { id: t.arg.string({ required: true }) },
      extensions: { access: designWrite(designAudit.imageImported) },
      resolve: async (_, args, ctx: StoreContext) => answered(await studioFor(ctx).stockUse(args.id)),
    }),
    importDesignImage: t.id({
      args: { url: t.arg.string({ required: true }) },
      extensions: { access: designWrite(designAudit.imageImported) },
      resolve: async (_, args, ctx: StoreContext) => answered(await studioFor(ctx).importImage(args.url)),
    }),
    saveDesignText: t.boolean({
      args: { locale: t.arg.string({ required: true }), key: t.arg.string({ required: true }), text: t.arg.string({ required: true }) },
      extensions: { access: designWrite(designAudit.textEdited) },
      resolve: async (_, args, ctx: StoreContext) => answered(await studioFor(ctx).saveText(args.locale, args.key, args.text)),
    }),
    undoDesignChange: t.field({
      type: Message,
      args: { messageId: t.arg.id({ required: true }) },
      extensions: { access: designWrite(designAudit.changeUndone) },
      resolve: async (_, args, ctx: StoreContext) => answered(await studioFor(ctx).undo(String(args.messageId))),
    }),
    discardDraft: t.boolean({
      extensions: { access: designWrite(designAudit.discarded) },
      resolve: async (_, __, ctx: StoreContext) => answered(await studioFor(ctx).discard()),
    }),
    // Re-checks the seat each time (every 2 minutes from the portal); a refusal ends the session (AI-STUDIO §8).
    // Open to any signed-in person, so a seat lost since still reaches here and the session ends rather than lingering.
    renewStudioSession: t.string({
      args: { session: t.arg.string({ required: true }) },
      extensions: { access: { api: 'store', scope: 'session', permission: null, unlogged: 'studio_renewal', whileReadOnly: true, blockedFor: ['support', 'impersonation'] } },
      resolve: async (_, args, ctx: StoreContext) => {
        if (!ctx.sql) throw forbidden()
        if (ctx.standing.kind === 'acting') return answered(await studioFor(ctx).renew(args.session)).toISOString()
        const person = standingPerson(ctx.standing)
        if (person) await endStudioSession(ctx.sql, person.id, args.session)
        return answered<Date>({ ok: false, reason: 'SESSION_ENDED' }).toISOString()
      },
    }),
  }))
}
