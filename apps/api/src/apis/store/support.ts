import { GraphQLError } from 'graphql'
import { askForSupportWrite, createStoreSupportService, storeSupportAudit, supportLogPageSize, type StoreSupportSessionDto } from '#saas/storeSupport/index'
import { pageWindow } from '#core/paging'
import { forbidden } from '../graphql/scope'
import { actingCaller, type StoreContext } from './access'
import { pageInfoType, type StoreBuilder } from './builder'

// Settings › Support access (SetAccess, FIRST-RELEASE §15), the banner's Allow / Deny, and the agent's
// request for writes (ACCESS.md §8; #331). The agent's cookie, bar and End now are apis/store/supportSession.ts.

const refused = (code: string, message: string) => new GraphQLError(message, { extensions: { code } })

const messages = {
  NOT_PENDING: 'That support session isn’t asking for changes now.',
  INVALID_INPUT: 'Say what you need to change, in 500 characters or fewer.',
  ALREADY_ASKED: 'You’ve asked already. The store hasn’t answered yet.',
  ALREADY_ALLOWED: 'The store has already let you make changes.',
  SESSION_ENDED: 'This support session has ended.',
  INVALID_CURSOR: 'That page link has expired. Start again.',
} as const

export const registerSupport = (builder: StoreBuilder) => {
  const PageInfo = pageInfoType(builder)

  const serviceOf = (ctx: StoreContext) => {
    if (!ctx.sql) throw forbidden()
    return createStoreSupportService({ sql: ctx.sql, caller: actingCaller(ctx), activity: ctx.activity, facts: ctx.facts, now: ctx.now })
  }

  type Request = NonNullable<StoreSupportSessionDto['writeRequest']>
  const WriteRequest = builder.objectRef<Request>('SupportSessionWriteRequest').implement({
    fields: (t) => ({
      note: t.exposeString('note'),
      requestedAt: t.string({ resolve: (r) => r.requestedAt.toISOString() }),
      // pending, allowed or denied
      state: t.exposeString('state'),
    }),
  })
  const ActingAs = builder.objectRef<StoreSupportSessionDto['actingAs']>('SupportActingAs').implement({
    fields: (t) => ({ name: t.exposeString('name'), role: t.exposeString('role'), supplier: t.exposeString('supplier', { nullable: true }) }),
  })
  const Session = builder.objectRef<StoreSupportSessionDto>('StoreSupportSession').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      agentName: t.string({ resolve: (s) => s.agent.name }),
      partnerName: t.exposeString('partnerName'),
      actingAs: t.field({ type: ActingAs, resolve: (s) => s.actingAs }),
      reason: t.exposeString('reason'),
      ticket: t.exposeString('ticket', { nullable: true }),
      startedAt: t.string({ resolve: (s) => s.startedAt.toISOString() }),
      expiresAt: t.string({ resolve: (s) => s.expiresAt.toISOString() }),
      endedAt: t.string({ nullable: true, resolve: (s) => s.endedAt?.toISOString() ?? null }),
      // agent, colleague, store, expired, targetGone or storeClosed; null while open
      endedBy: t.exposeString('endedBy', { nullable: true }),
      endedByName: t.exposeString('endedByName', { nullable: true }),
      // read, or write once allowed
      access: t.exposeString('access'),
      allowedBy: t.exposeString('allowedBy', { nullable: true }),
      writeRequest: t.field({ type: WriteRequest, nullable: true, resolve: (s) => s.writeRequest }),
    }),
  })
  const Sessions = builder.objectRef<{ nodes: StoreSupportSessionDto[]; pageInfo: { startCursor: string | null; endCursor: string | null; hasPreviousPage: boolean; hasNextPage: boolean } }>('StoreSupportSessions').implement({
    fields: (t) => ({ nodes: t.field({ type: [Session], resolve: (p) => p.nodes }), pageInfo: t.field({ type: PageInfo, resolve: (p) => p.pageInfo }) }),
  })
  const Access = builder.objectRef<{ allowed: boolean; sessions: { nodes: StoreSupportSessionDto[]; pageInfo: { startCursor: string | null; endCursor: string | null; hasPreviousPage: boolean; hasNextPage: boolean } } }>('SupportAccess').implement({
    fields: (t) => ({ allowed: t.exposeBoolean('allowed'), sessions: t.field({ type: Sessions, resolve: (a) => a.sessions }) }),
  })
  const Switched = builder.objectRef<{ allowed: boolean; ended: number }>('SupportAccessSet').implement({
    fields: (t) => ({ allowed: t.exposeBoolean('allowed'), ended: t.exposeInt('ended') }),
  })

  const settings = { api: 'store', scope: 'store', permission: 'settings', target: 'none' } as const
  const decide = { api: 'store', scope: 'store', permission: 'support.allow_write', target: 'none' } as const

  builder.queryFields((t) => ({
    supportAccess: t.field({
      type: Access,
      args: { first: t.arg.int(), after: t.arg.string(), before: t.arg.string() },
      // Other agents' reasons, tickets and requests are the merchant's to read, never a session's (ACCESS.md §8).
      extensions: { access: { ...settings, blockedFor: ['support'] } },
      resolve: (_, args, ctx) => {
        const window = pageWindow(args, supportLogPageSize)
        if (!window.ok) throw refused(window.code, messages.INVALID_CURSOR)
        return serviceOf(ctx).supportAccess(window.window)
      },
    }),
  }))

  builder.mutationFields((t) => ({
    // A privacy control, so a read-only store may still switch support off.
    setSupportAccess: t.field({
      type: Switched,
      args: { allowed: t.arg.boolean({ required: true }) },
      extensions: { access: { ...settings, audit: storeSupportAudit.setSupportAccess, blockedFor: ['support'], whileReadOnly: true } },
      resolve: (_, { allowed }, ctx) => serviceOf(ctx).setSupportAccess(allowed),
    }),
    allowSupportWrite: t.boolean({
      args: { sessionId: t.arg.id({ required: true }) },
      extensions: { access: { ...decide, audit: storeSupportAudit.allowSupportWrite, blockedFor: ['support'] } },
      resolve: async (_, { sessionId }, ctx) => {
        const result = await serviceOf(ctx).decide(String(sessionId), true)
        if (!result.ok) throw refused(result.reason, messages[result.reason])
        return true
      },
    }),
    // Deny changes nothing in the store, so a read-only store may answer it.
    denySupportWrite: t.boolean({
      args: { sessionId: t.arg.id({ required: true }) },
      extensions: { access: { ...decide, audit: storeSupportAudit.denySupportWrite, blockedFor: ['support'], whileReadOnly: true } },
      resolve: async (_, { sessionId }, ctx) => {
        const result = await serviceOf(ctx).decide(String(sessionId), false)
        if (!result.ok) throw refused(result.reason, messages[result.reason])
        return true
      },
    }),
    // The agent's own: every seat reads the catalogue, so `catalog.read` admits any support session's seat.
    requestSupportWrite: t.boolean({
      args: { note: t.arg.string({ required: true }) },
      extensions: { access: { api: 'store', scope: 'store-seller', permission: 'catalog.read', target: 'none', audit: storeSupportAudit.requestSupportWrite, supportOwn: true, whileReadOnly: true } },
      resolve: async (_, { note }, ctx) => {
        const caller = actingCaller(ctx)
        if (!ctx.sql || !caller.support) throw forbidden()
        const result = await askForSupportWrite({ sql: ctx.sql, caller, seat: caller.support, activity: ctx.activity, facts: ctx.facts, now: ctx.now }, note)
        if (!result.ok) throw refused(result.reason, messages[result.reason])
        return true
      },
    }),
  }))
}
