import SchemaBuilder from '@pothos/core'
import type { StaffMember } from '#auth/staff'

export interface AdminContext extends Record<string, unknown> {
  staff: StaffMember | null
}

const builder = new SchemaBuilder<{ Context: AdminContext }>({})

const Staff = builder.objectRef<StaffMember>('Staff').implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    email: t.exposeString('email'),
    name: t.exposeString('name'),
    role: t.exposeString('role'),
  }),
})

builder.queryType({
  fields: (t) => ({
    health: t.string({ resolve: () => 'ok' }),
    // Null when signed out: the console asks this to decide whether to show the sign-in
    // screen, so it is not an error.
    me: t.field({ type: Staff, nullable: true, resolve: (_, __, ctx) => ctx.staff }),
  }),
})

export const adminSchema = builder.toSchema()
