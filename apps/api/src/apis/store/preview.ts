import { GraphQLError } from 'graphql'
import { withScope, withSystemScope } from '#db/scoped/index'
import { endPreviewLinks, previewLinkFor } from '#saas/storefronts/preview'
import { forbidden } from '../graphql/scope'
import { actingCaller, type StoreContext } from './access'
import type { StoreBuilder } from './builder'

// "Open preview" (storefront PREVIEW.md §5 step 1): a signed link to the store's own preview host, for a seat that may
// publish (ACCESS §5.1). The link itself is never logged; the entry says only who opened one.

export const previewAudit = { opened: 'storefront.preview_opened', linksEnded: 'storefront.preview_links_ended' } as const

export const registerPreview = (builder: StoreBuilder) => {
  builder.mutationFields((t) => ({
    // The card's `previewLink` (#318), a mutation since it records who opened one.
    previewLink: t.string({
      // A support session or a staff session acts as someone else, and a link names its issuer (PREVIEW §5 step 4).
      extensions: { access: { api: 'store', scope: 'store', permission: 'publish', target: 'none', audit: previewAudit.opened, blockedFor: ['support', 'impersonation', 'setup'] } },
      resolve: async (_, __, ctx: StoreContext) => {
        if (!ctx.sql) throw forbidden()
        const caller = actingCaller(ctx)
        if (!ctx.preview) throw new GraphQLError('Previews aren’t set up here yet.', { extensions: { code: 'NOT_CONNECTED' } })
        const now = ctx.now()
        const link = await previewLinkFor(ctx.sql, ctx.preview.links, ctx.preview.domain, caller.context.storeId, caller.person.id, now)
        if (!link) throw new GraphQLError('That is no longer here.', { extensions: { code: 'NOT_FOUND' } })
        await withScope(ctx.sql, caller.context, (tx) =>
          ctx.activity.record(tx, {
            category: 'write',
            action: previewAudit.opened,
            result: 'success',
            actorKind: 'person',
            actorId: caller.person.id,
            actorLabel: null,
            partnerId: caller.person.partnerId,
            storeId: caller.context.storeId,
            target: { type: 'storefront', id: caller.context.storeId, label: 'Preview' },
            reason: null,
            api: 'store',
            visibility: 'store',
            ...ctx.facts,
          }),
        )
        return link
      },
    }),
    // "End all preview links" (PREVIEW §5 step 4, §8): every link and cookie for the store stops at its next request.
    endPreviewLinks: t.boolean({
      extensions: { access: { api: 'store', scope: 'store', permission: 'publish', target: 'none', audit: previewAudit.linksEnded, blockedFor: ['support', 'impersonation', 'setup'] } },
      resolve: async (_, __, ctx: StoreContext) => {
        if (!ctx.sql) throw forbidden()
        const caller = actingCaller(ctx)
        return withSystemScope(ctx.sql, async (tx) => {
          if (!(await endPreviewLinks(tx, caller.context.storeId))) throw new GraphQLError('That is no longer here.', { extensions: { code: 'NOT_FOUND' } })
          await ctx.activity.record(tx, {
            category: 'write',
            action: previewAudit.linksEnded,
            result: 'success',
            actorKind: 'person',
            actorId: caller.person.id,
            actorLabel: null,
            partnerId: caller.person.partnerId,
            storeId: caller.context.storeId,
            target: { type: 'storefront', id: caller.context.storeId, label: 'Preview' },
            reason: null,
            api: 'store',
            visibility: 'store',
            ...ctx.facts,
          })
          return true
        })
      },
    }),
  }))
}
