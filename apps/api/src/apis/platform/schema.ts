import type { PartnerCaller } from '#auth/partnerCaller'
import { secureSchema } from '../graphql/scope'
import { platformPolicy } from './access'
import { builder } from './builder'
import './shell'

export type { PlatformContext } from './access'

const Partner = builder.objectRef<PartnerCaller['partner']>('Partner').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
    product: t.exposeString('product'),
    host: t.exposeString('host', { nullable: true }),
    state: t.exposeString('state'),
  }),
})

const Me = builder.objectRef<PartnerCaller>('Me').implement({
  fields: (t) => ({
    id: t.id({ resolve: (c) => c.user.id }),
    name: t.string({ resolve: (c) => c.user.name }),
    email: t.string({ resolve: (c) => c.user.email }),
    role: t.string({ resolve: (c) => c.user.role }),
    partner: t.field({ type: Partner, resolve: (c) => c.partner }),
  }),
})

builder.queryFields((t) => ({
  health: t.string({ extensions: { access: { api: 'platform', scope: 'public', permission: null } }, resolve: () => 'ok' }),
  // Null when signed out, as the admin console's is: the console asks this to decide whether
  // to show sign-in, so it is public rather than an UNAUTHENTICATED error.
  me: t.field({
    type: Me,
    nullable: true,
    extensions: { access: { api: 'platform', scope: 'public', permission: null } },
    resolve: (_, __, ctx) => ctx.caller,
  }),
}))

export const platformSchema = secureSchema(builder.toSchema(), platformPolicy)
