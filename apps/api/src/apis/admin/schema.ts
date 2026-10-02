import type { StaffMember } from '#auth/staff'
import { secureSchema } from '../graphql/scope'
import { adminPolicy } from './access'
import { builder } from './builder'
import './activity'
import './partners'

export type { AdminContext } from './access'

const Staff = builder.objectRef<StaffMember>('Staff').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    email: t.exposeString('email'),
    name: t.exposeString('name'),
    role: t.exposeString('role'),
  }),
})

builder.queryFields((t) => ({
  health: t.string({ extensions: { access: { api: 'admin', scope: 'public', permission: null } }, resolve: () => 'ok' }),
  // Null when signed out: the console asks this to decide whether to show the sign-in
  // screen, so it is public rather than an UNAUTHENTICATED error.
  me: t.field({
    type: Staff,
    nullable: true,
    extensions: { access: { api: 'admin', scope: 'public', permission: null } },
    resolve: (_, __, ctx) => ctx.staff,
  }),
}))

export const adminSchema = secureSchema(builder.toSchema(), adminPolicy)
