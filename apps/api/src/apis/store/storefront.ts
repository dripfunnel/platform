import { GraphQLError } from 'graphql'
import { createDesignerService, designAudit, type DesignRefusal, type DesignResult, type StorefrontView, type TemplateView } from '#saas/ai-designer/index'
import type { VersionHistoryRow } from '#db/scoped/design'
import { forbidden } from '../graphql/scope'
import { actingCaller, type StoreContext } from './access'
import type { StoreBuilder } from './builder'

// Storefront (PortalStorefront; FIRST-RELEASE §14, §19): the Owner changes the design (`publish`), the Manager reads it
// (`storefront.read`), Staff and suppliers have no Storefront (ACCESS §5.1). The studio is a person's: a support or staff
// session acting as someone else neither changes nor opens it (AI-STUDIO §8).

const words: Record<DesignRefusal['reason'], string> = {
  BRAND_NOT_READY: 'Add your shop name and logo first.',
  INVALID_TEMPLATE: 'That template isn’t offered.',
  OWN_FRONTEND: 'This store uses its own storefront, so it has no template.',
  IN_PROGRESS: 'Your storefront is still being set up.',
  NOT_CONNECTED: 'The studio isn’t set up here yet.',
  STUDIO_UNAVAILABLE: 'The studio couldn’t start. Try again in a minute.',
  STUDIO_QUEUED: 'The studio is waiting for room.',
  CHANGE_REFUSED: 'That change didn’t pass our checks — nothing on your site changed.',
  NOT_FOUND: 'That isn’t here any more.',
  INVALID_INPUT: 'Something here isn’t valid.',
  INVALID_IMAGE: 'Use an image you uploaded to this store.',
  INVALID_URL: 'Use a public website address starting with https://.',
  INVALID_LANGUAGE: 'Your shop doesn’t offer that language.',
  SAMPLE_UNAVAILABLE: 'We couldn’t open that website. Try another address.',
  AI_BUDGET_REACHED: 'You’ve used this month’s AI requests.',
  AI_NOT_CONNECTED: 'Add your AI key to design with AI.',
  SESSION_ENDED: 'Your studio session ended. Reopen the studio to keep designing.',
  NOT_LATEST: 'Only your latest change can be undone.',
  NOTHING_TO_DISCARD: 'There are no unpublished changes to discard.',
  NOTHING_TO_PUBLISH: 'There are no changes to publish.',
  NOT_BISECTED: 'That change isn’t the one a refused publish named.',
  ALREADY_LIVE: 'That version is already live.',
  PUBLISH_RUNNING: 'Wait for the publish in progress to finish.',
  BUILD_GONE: 'That version can’t be restored any more.',
  NOTHING_LIVE: 'Publish your design first.',
  NOTHING_WAITING: 'Your live site is already up to date.',
  NO_PRESSES_LEFT: 'You’ve used this month’s Publish now presses. Your changes go live with the next automatic publish.',
}

export const answered = <T>(result: DesignResult<T>): T => {
  if (result.ok) return result.value
  const facts = 'place' in result ? { place: result.place } : 'problems' in result ? { problems: result.problems } : {}
  throw new GraphQLError(words[result.reason], { extensions: { code: result.reason, ...facts } })
}

export const designerFor = (ctx: StoreContext) => {
  if (!ctx.sql) throw forbidden()
  const caller = actingCaller(ctx)
  return createDesignerService({
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
export const designWrite = (audit: string) => ({ api: 'store', scope: 'store', permission: 'publish', target: 'none', audit, blockedFor: ['support', 'impersonation'] }) as const

export const registerStorefront = (builder: StoreBuilder) => {
  const Template = builder.objectRef<TemplateView>('StorefrontTemplate').implement({
    fields: (t) => ({
      key: t.exposeString('key'),
      name: t.exposeString('name'),
      // The gallery's short label, "Minimal fashion".
      tag: t.exposeString('tag'),
      description: t.exposeString('description'),
      // The demo store's live site, opened in a new tab; null until a demo store is live.
      demoUrl: t.exposeString('demoUrl', { nullable: true }),
      // "Your current look".
      current: t.exposeBoolean('current'),
    }),
  })

  const Live = builder.objectRef<NonNullable<StorefrontView['live']>>('StorefrontLiveVersion').implement({
    fields: (t) => ({
      number: t.exposeInt('number'),
      publishedAt: t.string({ resolve: (v) => v.publishedAt.toISOString() }),
      template: t.exposeString('template', { nullable: true }),
    }),
  })
  const Draft = builder.objectRef<NonNullable<StorefrontView['draft']>>('StorefrontDraft').implement({
    fields: (t) => ({
      template: t.exposeString('template'),
      changedAt: t.string({ nullable: true, resolve: (d) => d.changedAt?.toISOString() ?? null }),
      // "Open preview ↗" shows only with a draft whose preview folder is written.
      previewReady: t.exposeBoolean('previewReady'),
    }),
  })
  const Version = builder.objectRef<VersionHistoryRow>('StorefrontVersion').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      number: t.exposeInt('number'),
      template: t.exposeString('template'),
      coreVersion: t.exposeString('core_version'),
      // The merchant's last request before publishing, or null.
      label: t.exposeString('label', { nullable: true }),
      live: t.boolean({ resolve: (v) => v.state === 'live' }),
      publishedAt: t.string({ resolve: (v) => v.published_at.toISOString() }),
    }),
  })
  const Storefront = builder.objectRef<StorefrontView>('Storefront').implement({
    fields: (t) => ({
      // not_started, creating, create_failed, not_published, same_as_live or unpublished_changes.
      status: t.exposeString('status'),
      template: t.exposeString('template', { nullable: true }),
      live: t.field({ type: Live, nullable: true, resolve: (s) => s.live }),
      draft: t.field({ type: Draft, nullable: true, resolve: (s) => s.draft }),
      // Kept for the plan's days, the live version always; newest first, 50 at a time before a version's number.
      history: t.field({ type: [Version], args: { before: t.arg.int() }, resolve: (_, args, ctx: StoreContext) => designerFor(ctx).history(args.before ?? null) }),
    }),
  })

  builder.queryFields((t) => ({
    storefront: t.field({ type: Storefront, extensions: { access: read }, resolve: (_, __, ctx: StoreContext) => designerFor(ctx).overview() }),
    storefrontTemplates: t.field({ type: [Template], extensions: { access: read }, resolve: (_, __, ctx: StoreContext) => designerFor(ctx).templates() }),
  }))

  builder.mutationFields((t) => ({
    // The first time starts the store's repo; later it is a change to the private draft. Answers the new status.
    chooseTemplate: t.string({
      args: { key: t.arg.string({ required: true }), keepWords: t.arg.boolean({ required: true }) },
      extensions: { access: designWrite(designAudit.templateChosen) },
      resolve: async (_, args, ctx: StoreContext) => answered(await designerFor(ctx).chooseTemplate(args.key, args.keepWords)),
    }),
  }))
  return { Storefront }
}
