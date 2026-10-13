import type { LastPublishRow, PublishRunView } from '#db/scoped/publishing'
import { createPublishingService, designAudit, type CatalogueView, type UsageView } from '#saas/ai-designer/index'
import { forbidden } from '../graphql/scope'
import { actingCaller, type StoreContext } from './access'
import type { StoreBuilder } from './builder'
import { answered, designWrite, type registerStorefront } from './storefront'

// Publishing from the studio (PortalStorefront's Publish and Version history; FIRST-RELEASE §14, §19; storefront
// AI-STUDIO §6): the Owner publishes and goes back; the Manager reads a run's steps and checks.

const publishingFor = (ctx: StoreContext) => {
  if (!ctx.sql) throw forbidden()
  const caller = actingCaller(ctx)
  return createPublishingService({
    sql: ctx.sql,
    context: caller.context,
    actor: { id: caller.person.id, partnerId: caller.person.partnerId },
    activity: ctx.activity,
    facts: ctx.facts,
    studio: ctx.studio?.(caller.context) ?? null,
    now: ctx.now,
  })
}

const read = { api: 'store', scope: 'store', permission: 'storefront.read', target: 'none' } as const

/** FIRST-RELEASE §14's steps: "Building your site…", "Checking your site…", "Checking it went live…". */
const stepOf = (state: PublishRunView['state']): string => {
  if (state === 'queued') return 'queued'
  if (state === 'building' || state === 'checking' || state === 'checked') return 'checking'
  if (state === 'deploying') return 'going_live'
  return state
}

export const registerPublishing = (builder: StoreBuilder, storefront: ReturnType<typeof registerStorefront>) => {
  const Catalogue = builder.objectRef<CatalogueView>('StorefrontCatalogue').implement({
    fields: (t) => ({
      // Catalogue changes wait for a publish (the "Publish now" bar shows only then).
      waiting: t.exposeBoolean('waiting'),
      since: t.string({ nullable: true, resolve: (c) => c.since?.toISOString() ?? null }),
      // products, collections, menus, content or settings.
      changedKinds: t.exposeStringList('changedKinds'),
      changedProducts: t.exposeInt('changedProducts'),
      // Null when the plan's presses are unlimited.
      pressesAllowed: t.exposeInt('pressesAllowed', { nullable: true }),
      pressesLeft: t.exposeInt('pressesLeft', { nullable: true }),
      nextAutomaticPublishAt: t.string({ nullable: true, resolve: (c) => c.nextAutomaticPublishAt?.toISOString() ?? null }),
    }),
  })
  const Recent = builder.objectRef<UsageView['recent'][number]>('StorefrontRequest').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      // The merchant's own words.
      text: t.exposeString('prompt'),
      outcome: t.exposeString('outcome'),
      tokens: t.exposeInt('tokens'),
      createdAt: t.string({ resolve: (r) => r.created_at.toISOString() }),
    }),
  })
  const Usage = builder.objectRef<UsageView>('StorefrontUsage').implement({
    fields: (t) => ({
      // "On your own AI key": no plan meter for requests.
      ownKey: t.exposeBoolean('ownKey'),
      aiRequests: t.exposeInt('aiRequests'),
      aiTokens: t.exposeInt('aiTokens'),
      aiPromptsUsed: t.exposeInt('aiPromptsUsed'),
      aiPromptsAllowed: t.exposeInt('aiPromptsAllowed', { nullable: true }),
      // This month's, the store's own publishes; plans set no build-minute limit, so none is answered.
      buildMinutes: t.exposeInt('buildMinutes'),
      publishesLast30Days: t.exposeInt('publishesLast30Days'),
      recent: t.field({ type: [Recent], resolve: (u) => u.recent }),
    }),
  })
  const LastPublish = builder.objectRef<LastPublishRow>('StorefrontLastPublish').implement({
    fields: (t) => ({
      // live, failed or rolled_back.
      state: t.exposeString('state'),
      // The failed check's or the rollback's code (LOGGING's storefront.publish_failed and storefront.rolled_back).
      error: t.exposeString('error', { nullable: true }),
      // The version it made live; null once failed or rolled back, since a rollback withdraws it (LIVE-SHOP §4 step 10).
      version: t.exposeInt('version', { nullable: true }),
      finishedAt: t.string({ resolve: (p) => p.finished_at.toISOString() }),
    }),
  })
  builder.objectFields(storefront.Storefront, (t) => ({
    // The newest finished design or catalogue publish (not a page render); null before the first.
    lastPublish: t.field({ type: LastPublish, nullable: true, resolve: (_, __, ctx: StoreContext) => publishingFor(ctx).lastPublish() }),
    catalogue: t.field({ type: Catalogue, resolve: (_, __, ctx: StoreContext) => publishingFor(ctx).catalogue() }),
    usage: t.field({ type: Usage, resolve: (_, __, ctx: StoreContext) => publishingFor(ctx).usage() }),
  }))

  type Check = { name: string; passed: boolean; words: string | null }
  const CheckRef = builder.objectRef<Check>('PublishCheck').implement({
    fields: (t) => ({
      name: t.exposeString('name'),
      passed: t.exposeBoolean('passed'),
      // What failed, in plain words; never code.
      words: t.exposeString('words', { nullable: true }),
    }),
  })
  const Run = builder.objectRef<PublishRunView>('PublishRun').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      // design, manual, automatic, staff, page, security or rollback.
      kind: t.exposeString('kind'),
      // queued, building, checking, checked, deploying, live, failed or rolled_back.
      state: t.exposeString('state'),
      // queued, checking, going_live, live, failed or rolled_back.
      step: t.string({ resolve: (r) => stepOf(r.state) }),
      error: t.exposeString('error', { nullable: true }),
      repairAttempts: t.exposeInt('repair_attempts'),
      buildMinutes: t.exposeInt('build_minutes', { nullable: true }),
      // The version this publish made live.
      version: t.exposeInt('version', { nullable: true }),
      // The full gate's checks, then the post-deploy checks once it went live.
      checks: t.field({
        type: [CheckRef],
        resolve: (r) => [
          ...(r.gate?.checks ?? []).map((c) => ({ name: c.name, passed: c.passed, words: c.detail ?? null })),
          ...(r.checks ?? []).map((c) => ({ name: c.name, passed: c.result !== 'failed', words: c.result === 'failed' ? c.detail : null })),
        ],
      }),
      // The change bisect named: "Publish everything before this change" (publishBefore with this message).
      bisectMessageId: t.exposeID('bisect_message_id', { nullable: true }),
      createdAt: t.string({ resolve: (r) => r.created_at.toISOString() }),
      finishedAt: t.string({ nullable: true, resolve: (r) => r.finished_at?.toISOString() ?? null }),
    }),
  })

  builder.queryFields((t) => ({
    publishRun: t.field({
      type: Run,
      nullable: true,
      args: { id: t.arg.id({ required: true }) },
      extensions: { access: read },
      resolve: (_, args, ctx: StoreContext) => publishingFor(ctx).publishRun(String(args.id)),
    }),
  }))

  builder.mutationFields((t) => ({
    // The draft through the full pipeline; answers the publish's id for publishRun.
    publishDesign: t.id({
      extensions: { access: designWrite(designAudit.publishStarted) },
      resolve: async (_, __, ctx: StoreContext) => answered(await publishingFor(ctx).publishDesign()),
    }),
    publishBefore: t.id({
      args: { messageId: t.arg.id({ required: true }) },
      extensions: { access: designWrite(designAudit.publishStarted) },
      resolve: async (_, args, ctx: StoreContext) => answered(await publishingFor(ctx).publishEverythingBefore(String(args.messageId))),
    }),
    // The live code rebuilt with the catalogue as it is, using one of the month's presses once it goes live.
    publishNow: t.id({
      extensions: { access: designWrite(designAudit.publishStarted) },
      resolve: async (_, __, ctx: StoreContext) => answered(await publishingFor(ctx).publishNow()),
    }),
    // Moves the live site to the version's kept build (no build minutes) and resets the draft to it.
    goBackToVersion: t.boolean({
      args: { number: t.arg.int({ required: true }) },
      extensions: { access: designWrite(designAudit.reverted) },
      resolve: async (_, args, ctx: StoreContext) => answered(await publishingFor(ctx).goBackTo(args.number)),
    }),
  }))
}
