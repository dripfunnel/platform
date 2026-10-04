import { actingId, actingName, type PartnerCaller } from '#auth/partnerCaller'
import { secureSchema } from '../graphql/scope'
import { platformPolicy } from './access'
import { builder } from './builder'
import './shell'
import './plans'
import './branding'
import './storeCreate'
import './stores'
import './storeActions'
import './dashboard'
import './domains'
import './activity'
import './settings'
import './reports'
import './support'

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
    // In a setup session, the staff member with the Owner's role (ACCESS.md §8.2).
    id: t.id({ resolve: actingId }),
    name: t.string({ resolve: actingName }),
    email: t.string({ resolve: (c) => c.user?.email ?? c.staff?.email ?? '' }),
    role: t.string({ resolve: (c) => c.role }),
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
