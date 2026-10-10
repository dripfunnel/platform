import { GraphQLError } from 'graphql'
import { pageOf, type Page } from '#core/paging'
import { storeEvents } from '#db/scoped/storeEvents'
import type { DeliveryRow, EndpointRow } from '#db/scoped/webhooks'
import { createWebhooksService, maxEndpoints, webhookAudit, type WebhookRefusal, type WebhookResult } from '#saas/webhooks/index'
import { forbidden } from '../graphql/scope'
import { actingCaller, type StoreContext } from './access'
import { pageInfoType, type StoreBuilder } from './builder'
import { storePage } from './refusals'

// Settings › Developers' webhooks (FIRST-RELEASE §15, SetDev): the Owner's (`settings`); the rules are saas/webhooks's.

const words: Record<WebhookRefusal, string> = {
  INVALID_INPUT: 'Pick at least one event.',
  BAD_URL: 'Use an address that starts with https:// and that the internet can find.',
  PRIVATE_ADDRESS: 'That address points inside a private network. Use one the internet can reach.',
  NOT_FOUND: 'That endpoint or delivery is no longer here.',
  TOO_MANY_ENDPOINTS: `A store can have up to ${maxEndpoints} endpoints. Remove one first.`,
  UNAVAILABLE: 'We couldn’t check that address just now. Try again.',
  ENDPOINT_OFF: 'This endpoint is turned off. Turn it back on to send its events.',
  TOO_OLD: 'Events can be sent again for 7 days.',
}

const answered = <T>(result: WebhookResult<T>): T => {
  if (result.ok) return result.value
  throw new GraphQLError(words[result.reason], { extensions: { code: result.reason } })
}

const iso = (d: Date | null) => d?.toISOString() ?? null

export const registerWebhooks = (builder: StoreBuilder) => {
  const PageInfo = pageInfoType(builder)
  const Endpoint = builder.objectRef<EndpointRow>('WebhookEndpoint').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      url: t.exposeString('url'),
      events: t.exposeStringList('events'),
      // active | failing | disabled: turned off after 3 days of failures (ACCESS §5.6).
      status: t.exposeString('status'),
      failingSince: t.string({ nullable: true, resolve: (e) => iso(e.failing_since) }),
      disabledAt: t.string({ nullable: true, resolve: (e) => iso(e.disabled_at) }),
      createdAt: t.string({ resolve: (e) => e.created_at.toISOString() }),
    }),
  })
  const EndpointPage = builder.objectRef<Page<EndpointRow>>('WebhookEndpointPage').implement({
    fields: (t) => ({ nodes: t.field({ type: [Endpoint], resolve: (p) => p.nodes }), pageInfo: t.field({ type: PageInfo, resolve: (p) => p.pageInfo }) }),
  })
  const Delivery = builder.objectRef<DeliveryRow>('WebhookDelivery').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      event: t.exposeString('event'),
      eventId: t.exposeID('event_id'),
      // pending | delivered | failed | held (waiting for its endpoint to be turned back on).
      status: t.exposeString('status'),
      attempts: t.exposeInt('attempts'),
      responseCode: t.exposeInt('response_code', { nullable: true }),
      // A code, never the endpoint's own words: status, timeout, private_address, bad_url, unavailable, endpoint_removed, no_signing_key.
      error: t.exposeString('error', { nullable: true }),
      durationMs: t.exposeInt('duration_ms', { nullable: true }),
      createdAt: t.string({ resolve: (d) => d.created_at.toISOString() }),
      lastAttemptAt: t.string({ nullable: true, resolve: (d) => iso(d.last_attempt_at) }),
      deliveredAt: t.string({ nullable: true, resolve: (d) => iso(d.delivered_at) }),
      replayOf: t.exposeID('replay_of', { nullable: true }),
    }),
  })
  const DeliveryPage = builder.objectRef<Page<DeliveryRow>>('WebhookDeliveryPage').implement({
    fields: (t) => ({ nodes: t.field({ type: [Delivery], resolve: (p) => p.nodes }), pageInfo: t.field({ type: PageInfo, resolve: (p) => p.pageInfo }) }),
  })
  const Saved = builder.objectRef<{ id: string; secret: string | null }>('SavedWebhook').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      // The signing secret, in the answer that made the endpoint and in no other.
      secret: t.exposeString('secret', { nullable: true }),
    }),
  })

  const access = { api: 'store', scope: 'store', permission: 'settings', target: 'none' } as const
  const service = (ctx: StoreContext) => {
    if (!ctx.sql) throw forbidden()
    return createWebhooksService({ sql: ctx.sql, caller: actingCaller(ctx), activity: ctx.activity, facts: ctx.facts, secrets: ctx.secrets ?? null, lookup: ctx.lookup ?? null, now: ctx.now })
  }

  builder.queryFields((t) => ({
    webhookEvents: t.stringList({ extensions: { access }, resolve: () => [...storeEvents] }),
    webhooks: t.field({
      type: EndpointPage,
      args: { first: t.arg.int(), after: t.arg.string(), before: t.arg.string() },
      extensions: { access },
      resolve: async (_, args, ctx) => {
        const window = storePage(args)
        return pageOf(await service(ctx).list(window), window, (e) => ({ occurredAt: e.created_at, id: e.id }))
      },
    }),
    webhookDeliveries: t.field({
      type: DeliveryPage,
      args: { endpointId: t.arg.id({ required: true }), first: t.arg.int(), after: t.arg.string(), before: t.arg.string() },
      extensions: { access },
      resolve: async (_, args, ctx) => {
        const window = storePage(args)
        return pageOf(await service(ctx).deliveries(String(args.endpointId), window), window, (d) => ({ occurredAt: d.created_at, id: d.id }))
      },
    }),
  }))

  builder.mutationFields((t) => ({
    saveWebhook: t.field({
      type: Saved,
      args: { id: t.arg.id(), url: t.arg.string({ required: true }), events: t.arg.stringList({ required: true }) },
      extensions: { access: { ...access, audit: webhookAudit.saved, blockedFor: ['support'] } },
      resolve: async (_, args, ctx) => answered(await service(ctx).save(args.id ? String(args.id) : null, args.url, args.events)),
    }),
    removeWebhook: t.field({
      type: 'Boolean',
      args: { id: t.arg.id({ required: true }) },
      extensions: { access: { ...access, audit: webhookAudit.removed } },
      resolve: async (_, args, ctx) => answered(await service(ctx).remove(String(args.id))),
    }),
    // Answers how many waiting events it will send; a job queues them (webhook.release).
    turnOnWebhook: t.field({
      type: 'Int',
      args: { id: t.arg.id({ required: true }) },
      extensions: { access: { ...access, audit: webhookAudit.turnedOn } },
      resolve: async (_, args, ctx) => answered(await service(ctx).turnOn(String(args.id))),
    }),
    // Answers the new delivery's id.
    replayDelivery: t.field({
      type: 'ID',
      args: { id: t.arg.id({ required: true }) },
      extensions: { access: { ...access, audit: webhookAudit.replayed } },
      resolve: async (_, args, ctx) => answered(await service(ctx).replay(String(args.id))),
    }),
  }))
}
