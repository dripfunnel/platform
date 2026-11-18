import { createStudioService, designAudit, flowOf, type AskInput, type DesignRunOutput, type DesignRunParams, type DesignQuestion, type PlanFlow, type RunAnswer, type StudioSessionView, type TextEntry } from '#saas/ai-designer/index'
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

/** What the studio needs besides its caller, the same for a request and for the DesignRun job (index.ts `studioPiecesFor`). */
export type StudioPieces = Pick<StoreContext, 'activity' | 'facts' | 'studio' | 'design' | 'lookup' | 'files' | 'allowStock' | 'preview' | 'domains' | 'designRuns' | 'now'> & { sql: NonNullable<StoreContext['sql']> }
type StudioCaller = Pick<DesignRunParams, 'context' | 'actor' | 'role'>

const studioFor = (ctx: StoreContext) => {
  if (!ctx.sql) throw forbidden()
  const caller = actingCaller(ctx)
  return studioOf({ ...ctx, sql: ctx.sql }, { context: caller.context, actor: { id: caller.person.id, partnerId: caller.person.partnerId }, role: caller.role })
}

const studioOf = (ctx: StudioPieces, caller: StudioCaller) => {
  const design = ctx.design ?? null
  return createStudioService({
    sql: ctx.sql,
    context: caller.context,
    actor: caller.actor,
    activity: ctx.activity,
    facts: ctx.facts,
    studio: ctx.studio?.(caller.context) ?? null,
    role: caller.role,
    ai: design?.ai ?? (() => null),
    models: design?.models ?? (() => []),
    screenshots: design?.screenshots ?? null,
    reference: design?.reference ?? null,
    lookCache: design?.lookCache ?? null,
    lookup: ctx.lookup ?? null,
    assets: ctx.files ?? null,
    readAsset: design?.readAsset ?? null,
    stock: design?.stock ?? null,
    aiPhotos: design?.aiPhotos ?? [],
    allowStock: ctx.allowStock ?? (async () => false),
    previewDomain: ctx.preview?.domain ?? null,
    shopDomain: ctx.domains?.shopDomain ?? null,
    runs: ctx.designRuns ?? null,
    now: ctx.now,
  })
}

/** The DesignRun Workflow's step (jobs/workflows/design-run.ts), with the caller its params name. */
export const runDesign = (ctx: StudioPieces, params: DesignRunParams): Promise<DesignRunOutput> => studioOf(ctx, params).runHeld(params.run)

/** The studio's read access: its queries and its live socket (studioLive.ts). */
export const studioRead = { api: 'store', scope: 'store', permission: 'storefront.read', target: 'none' } as const
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
  const Question = builder.objectRef<DesignQuestion>('DesignQuestion').implement({
    fields: (t) => ({ text: t.exposeString('text'), options: t.exposeStringList('options') }),
  })
  const PlanPage = builder.objectRef<PlanFlow['plan']['pages'][number]>('DesignPlanPage').implement({
    fields: (t) => ({ page: t.exposeString('page'), title: t.exposeString('title'), sections: t.exposeStringList('sections') }),
  })
  const Plan = builder.objectRef<PlanFlow['plan']>('DesignPlan').implement({
    fields: (t) => ({ header: t.exposeString('header', { nullable: true }), footer: t.exposeString('footer', { nullable: true }), pages: t.field({ type: [PlanPage], resolve: (p) => p.pages }) }),
  })
  const BuildPageRef = builder.objectRef<{ page: string; title: string; outcome: string }>('DesignBuildPage').implement({
    fields: (t) => ({ page: t.exposeString('page'), title: t.exposeString('title'), outcome: t.exposeString('outcome') }),
  })
  const Build = builder.objectRef<{ pages: { page: string; title: string; outcome: string }[]; stopped: boolean }>('DesignBuild').implement({
    fields: (t) => ({ pages: t.field({ type: [BuildPageRef], resolve: (b) => b.pages }), stopped: t.exposeBoolean('stopped') }),
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
      // #1243: a questions message's questions, the answers given (in order, null for none), and a plan's pages.
      questions: t.field({ type: [Question], resolve: (m) => { const f = flowOf(m.detail); return f?.kind === 'questions' ? f.questions : [] } }),
      answers: t.stringList({ nullable: { list: true, items: true }, resolve: (m) => { const f = flowOf(m.detail); return f?.kind === 'questions' ? f.answers.map((a) => a.answer) : [] } }),
      plan: t.field({ type: Plan, nullable: true, resolve: (m) => { const f = flowOf(m.detail); return f?.kind === 'plan' ? f.plan : null } }),
      // A questions message's or a plan's: open (to answer or build), answered, skipped, replaced, building or built.
      flowState: t.string({ nullable: true, resolve: (m) => { const f = flowOf(m.detail); return f && f.kind !== 'build' ? f.state : null } }),
      // A build's pages, each changed, unchanged, refused, failed or left (Stop, or a page before it refused).
      build: t.field({ type: Build, nullable: true, resolve: (m) => { const f = flowOf(m.detail); return f?.kind === 'build' ? f : null } }),
    }),
  })
  const Chat = builder.objectRef<{ messages: MessageRow[]; next: string | null }>('DesignChat').implement({
    fields: (t) => ({
      // Newest first.
      messages: t.field({ type: [Message], resolve: (c) => c.messages }),
      next: t.exposeString('next', { nullable: true }),
    }),
  })
  const RunAnswerRef = builder.objectRef<RunAnswer>('DesignRunAnswer').implement({
    fields: (t) => ({
      // changed, unchanged (asked for nothing the theme holds, or declined), refused (failed the checks), failed, cancelled,
      // or asked: the AI answered a vague request with questions or a plan, the message (#1243).
      outcome: t.exposeString('outcome'),
      // Null when the run found nothing to do: stopped before it began.
      message: t.field({ type: Message, nullable: true, resolve: (a) => a.message }),
    }),
  })
  const StockPhotoRef = builder.objectRef<StockPhoto>('StockPhoto').implement({
    fields: (t) => ({ id: t.exposeString('id'), source: t.exposeString('source'), thumb: t.exposeString('thumb'), user: t.exposeString('user'), pageUrl: t.exposeString('pageUrl'), tags: t.exposeString('tags') }),
  })
  const Text = builder.objectRef<TextEntry>('DesignText').implement({
    fields: (t) => ({ key: t.exposeString('key'), text: t.exposeString('text') }),
  })

  builder.queryFields((t) => ({
    studioSession: t.field({
      type: Session,
      args: { session: t.arg.string() },
      extensions: { access: studioRead },
      resolve: async (_, args, ctx: StoreContext) => answered(await studioFor(ctx).session(args.session ?? null)),
    }),
    designChat: t.field({
      type: Chat,
      args: { after: t.arg.string() },
      extensions: { access: studioRead },
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
      extensions: { access: studioRead },
      resolve: async (_, __, ctx: StoreContext) => ctx.design?.stock != null,
    }),
    searchStockImages: t.field({
      type: [StockPhotoRef],
      args: { query: t.arg.string({ required: true }), page: t.arg.int({ required: true }) },
      extensions: { access: { api: 'store', scope: 'store', permission: 'publish', target: 'none' } },
      resolve: async (_, args, ctx: StoreContext) => answered(await studioFor(ctx).stockSearch(args.query, args.page)).photos,
    }),
    // A run askDesign, answerDesignQuestions, changeDesignPlan or buildDesignPlan started (AI-STUDIO §4 "A design run"): null while it works. The Owner's access, as
    // to start one; a support session acting as the Owner reads it as it reads the chat.
    designRun: t.field({
      type: RunAnswerRef,
      nullable: true,
      args: { run: t.arg.id({ required: true }) },
      extensions: { access: { api: 'store', scope: 'store', permission: 'publish', target: 'none' } },
      resolve: async (_, args, ctx: StoreContext) => answered(await studioFor(ctx).runResult(String(args.run))),
    }),
    designText: t.field({
      type: [Text],
      args: { page: t.arg.string({ required: true }), locale: t.arg.string({ required: true }) },
      extensions: { access: studioRead },
      resolve: async (_, args, ctx: StoreContext) => answered(await studioFor(ctx).texts(args.page, args.locale)),
    }),
  }))

  builder.mutationFields((t) => ({
    // Starts a run under `run`, a UUID the client made, and answers it at once; designRun reads its answer (AI-STUDIO §4).
    askDesign: t.id({
      args: { text: t.arg.string({ required: true }), model: t.arg.string(), imageAssetId: t.arg.id(), sampleUrl: t.arg.string(), page: t.arg.string({ required: true }), device: t.arg.string({ required: true }), mode: t.arg.string(), run: t.arg.id({ required: true }) },
      extensions: { access: designWrite(designAudit.designRequested) },
      resolve: async (_, args, ctx: StoreContext) => {
        const device = args.device === 'phone' || args.device === 'tablet' ? args.device : 'desktop'
        const input = { text: args.text, model: args.model ?? null, imageAssetId: args.imageAssetId ?? null, sampleUrl: args.sampleUrl ?? null, page: args.page, device, mode: args.mode === 'chat' ? 'chat' : 'change' } satisfies AskInput
        return answered(await studioFor(ctx).startRun({ kind: 'ask', input }, String(args.run)))
      },
    }),
    // #1243: "Make the plan" with the answers in the questions' order (an option, words of their own, or ""), or skip.
    answerDesignQuestions: t.id({
      args: { messageId: t.arg.id({ required: true }), answers: t.arg.stringList({ required: true }), skip: t.arg.boolean(), model: t.arg.string(), run: t.arg.id({ required: true }) },
      extensions: { access: designWrite(designAudit.questionsAnswered) },
      resolve: async (_, args, ctx: StoreContext) =>
        answered(await studioFor(ctx).startRun({ kind: 'questions', messageId: String(args.messageId), answers: args.answers, skip: args.skip ?? false, model: args.model ?? null }, String(args.run))),
    }),
    // A change to the open plan, asked in words; part of the same request, at most three times.
    changeDesignPlan: t.id({
      args: { messageId: t.arg.id({ required: true }), text: t.arg.string({ required: true }), model: t.arg.string(), run: t.arg.id({ required: true }) },
      extensions: { access: designWrite(designAudit.planChanged) },
      resolve: async (_, args, ctx: StoreContext) => answered(await studioFor(ctx).startRun({ kind: 'planChange', messageId: String(args.messageId), text: args.text, model: args.model ?? null }, String(args.run))),
    }),
    // Build it: every planned page, home first, each through the checks; cancelDesign stops it after the current page.
    buildDesignPlan: t.id({
      args: { messageId: t.arg.id({ required: true }), model: t.arg.string(), run: t.arg.id({ required: true }) },
      extensions: { access: designWrite(designAudit.planBuilt) },
      resolve: async (_, args, ctx: StoreContext) => answered(await studioFor(ctx).startRun({ kind: 'build', messageId: String(args.messageId), model: args.model ?? null }, String(args.run))),
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
    // Focus or typing in the studio, at most every 30 s: wakes a stopped container and puts off its idle stop (AI-STUDIO §7).
    studioActivity: t.boolean({
      extensions: { access: { ...studioRead, unlogged: 'studio_activity' } },
      resolve: async (_, __, ctx: StoreContext) => answered(await studioFor(ctx).wake()),
    }),
    // Re-checks the seat each time (every 2 minutes from the portal); a refusal ends the session (AI-STUDIO §8).
    // Open to any signed-in person, so a seat lost since still reaches here and the session ends rather than lingering.
    renewStudioSession: t.string({
      args: { session: t.arg.string({ required: true }) },
      extensions: { access: { api: 'store', scope: 'session', permission: null, unlogged: 'studio_renewal', whileReadOnly: true, openToSupport: true } },
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
