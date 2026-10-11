import type { PublishRunView } from '#db/scoped/publishing'
import { createPublishingService, designAudit } from '#saas/ai-designer/index'
import { forbidden } from '../graphql/scope'
import { actingCaller, type StoreContext } from './access'
import type { StoreBuilder } from './builder'
import { answered, designWrite } from './storefront'

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

export const registerPublishing = (builder: StoreBuilder) => {
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
    // Moves the live site to the version's kept build (no build minutes) and resets the draft to it.
    goBackToVersion: t.boolean({
      args: { number: t.arg.int({ required: true }) },
      extensions: { access: designWrite(designAudit.reverted) },
      resolve: async (_, args, ctx: StoreContext) => answered(await publishingFor(ctx).goBackTo(args.number)),
    }),
  }))
}
