import SchemaBuilder from '@pothos/core'
import { graphql, type GraphQLSchema } from 'graphql'
import { describe, expect, it, vi } from 'vitest'
import { adminSchema } from '#apis/admin/schema'
import { platformSchema } from '#apis/platform/schema'
import { shopSchema } from '#apis/shop/schema'
import { storeSchema } from '#apis/store/schema'
import type { AccessTarget } from '#auth/assignment'
import { roleHas, staffPermissions } from '#auth/permissions'
import { staffRoles, type StaffMember, type StaffRole } from '#auth/staff'
import { adminPolicy, type AdminContext } from '../admin/access'
import { secureSchema, type Access } from './scope'

const builderFor = () => new SchemaBuilder<{ Context: AdminContext }>({})

const declared = (access: Access) => {
  const builder = builderFor()
  builder.queryType({ fields: (t) => ({ field: t.string({ extensions: { access }, resolve: () => 'ok' }) }) })
  return () => secureSchema(builder.toSchema(), adminPolicy)
}

describe('a field without a valid declaration fails the build', () => {
  it('an undeclared query', () => {
    const builder = builderFor()
    builder.queryType({ fields: (t) => ({ field: t.string({ resolve: () => 'ok' }) }) })
    expect(() => secureSchema(builder.toSchema(), adminPolicy)).toThrow('Query.field declares no access')
  })

  it('an undeclared mutation', () => {
    const builder = builderFor()
    builder.queryType({
      fields: (t) => ({
        health: t.string({ extensions: { access: { api: 'admin', scope: 'public', permission: null } }, resolve: () => 'ok' }),
      }),
    })
    builder.mutationType({ fields: (t) => ({ pause: t.boolean({ resolve: () => true }) }) })
    expect(() => secureSchema(builder.toSchema(), adminPolicy)).toThrow('Mutation.pause declares no access')
  })

  it('a mutation that names no activity-log action', () => {
    const builder = builderFor()
    builder.queryType({
      fields: (t) => ({
        health: t.string({ extensions: { access: { api: 'admin', scope: 'public', permission: null } }, resolve: () => 'ok' }),
      }),
    })
    builder.mutationType({
      fields: (t) => ({
        pause: t.boolean({
          extensions: { access: { api: 'admin', scope: 'platform', permission: 'partners.pause', target: 'none' } },
          resolve: () => true,
        }),
      }),
    })
    expect(() => secureSchema(builder.toSchema(), adminPolicy)).toThrow('Mutation.pause declares no audit action')
  })

  it('a mutation that does', () => {
    const builder = builderFor()
    builder.queryType({
      fields: (t) => ({
        health: t.string({ extensions: { access: { api: 'admin', scope: 'public', permission: null } }, resolve: () => 'ok' }),
      }),
    })
    builder.mutationType({
      fields: (t) => ({
        pause: t.boolean({
          extensions: { access: { api: 'admin', scope: 'platform', permission: 'partners.pause', target: 'none', audit: 'partner.paused' } },
          resolve: () => true,
        }),
      }),
    })
    expect(() => secureSchema(builder.toSchema(), adminPolicy)).not.toThrow()
  })

  it('a field declared for another API', () => {
    expect(declared({ api: 'store', scope: 'public', permission: null })).toThrow('declared for the store API')
  })

  it('a scope the API does not serve', () => {
    expect(declared({ api: 'admin', scope: 'store', permission: 'stores.read', target: 'none' })).toThrow(
      'scope store',
    )
  })

  it('a platform field without a permission, or a public one with one', () => {
    expect(declared({ api: 'admin', scope: 'platform', permission: null, target: 'none' })).toThrow('without a permission')
    expect(declared({ api: 'admin', scope: 'public', permission: 'partners.read' })).toThrow('without a permission')
  })

  it('a platform field that does not say what it targets', () => {
    expect(declared({ api: 'admin', scope: 'platform', permission: 'partners.read' })).toThrow('declares no target')
  })

  it('a non-public field on the Platform, Store and Shop APIs, which have no policy yet', () => {
    const builder = new SchemaBuilder<object>({})
    builder.queryType({
      fields: (t) => ({
        field: t.string({ extensions: { access: { api: 'store', scope: 'session', permission: null } }, resolve: () => 'ok' }),
      }),
    })
    expect(() => secureSchema(builder.toSchema(), { api: 'store', scopes: ['public'], authorize: async () => {} })).toThrow(
      'scope session',
    )
  })

  it('a refusable object field that cannot be null', () => {
    const builder = builderFor()
    const Thing = builder.objectRef<{ secret: string }>('Thing').implement({
      fields: (t) => ({
        secret: t.exposeString('secret', {
          nullable: false,
          extensions: { access: { api: 'admin', scope: 'platform', permission: 'customers.contact.read', target: 'none' } },
        }),
      }),
    })
    builder.queryType({
      fields: (t) => ({
        thing: t.field({
          type: Thing,
          extensions: { access: { api: 'admin', scope: 'public', permission: null } },
          resolve: () => ({ secret: 's' }),
        }),
      }),
    })
    expect(() => secureSchema(builder.toSchema(), adminPolicy)).toThrow('Thing.secret must be nullable')
  })
})

describe('every schema the Worker serves', () => {
  it.each<[string, GraphQLSchema]>([
    ['admin', adminSchema],
    ['platform', platformSchema],
    ['store', storeSchema],
    ['shop', shopSchema],
  ])('%s declares every root field', (_, schema) => {
    for (const type of [schema.getQueryType(), schema.getMutationType()]) {
      for (const field of Object.values(type?.getFields() ?? {})) expect(field.extensions.access).toBeDefined()
    }
  })
})

const staffAs = (role: StaffRole): StaffMember => ({ id: 'staff-1', email: 's@softobotics.com', name: 'S', role })

const contextFor = (staff: StaffMember | null, assigned: readonly string[] = []): AdminContext => ({
  staff,
  isAssigned: async (_, target: AccessTarget) => assigned.includes('partnerId' in target ? target.partnerId : target.storeId),
  activity: async () => ({ ok: false, code: 'INVALID_FILTER' }),
  partners: null,
  stores: null,
})

const fieldName = (permission: string) => permission.replaceAll('.', '_')

// One query per permission, so each role is checked against the whole catalogue end to end.
const body = vi.fn(() => 'ok')
const catalogue = (() => {
  const builder = builderFor()
  const Customer = builder.objectRef<{ email: string }>('Customer').implement({
    fields: (t) => ({
      email: t.exposeString('email', {
        nullable: true,
        extensions: { access: { api: 'admin', scope: 'platform', permission: 'customers.contact.read', target: 'none' } },
      }),
    }),
  })
  builder.queryType({
    fields: (t) => ({
      ...Object.fromEntries(
        staffPermissions.map((permission) => [
          fieldName(permission),
          t.string({ extensions: { access: { api: 'admin', scope: 'platform', permission, target: 'none' } }, resolve: body }),
        ]),
      ),
      whoami: t.string({ extensions: { access: { api: 'admin', scope: 'session', permission: null } }, resolve: body }),
      partner: t.string({
        args: { id: t.arg.string({ required: true }) },
        extensions: {
          access: { api: 'admin', scope: 'platform', permission: 'partners.approve', target: ({ id }) => ({ partnerId: id }) },
        },
        resolve: body,
      }),
      customer: t.field({
        type: Customer,
        extensions: { access: { api: 'admin', scope: 'platform', permission: 'customers.read', target: 'none' } },
        resolve: () => ({ email: 'shopper@example.com' }),
      }),
    }),
  })
  return secureSchema(builder.toSchema(), adminPolicy)
})()

const run = (source: string, contextValue: AdminContext) => graphql({ schema: catalogue, source, contextValue })

const codeOf = (result: Awaited<ReturnType<typeof run>>) => result.errors?.[0]?.extensions['code']

describe.each(staffRoles)('%s through the check', (role) => {
  it.each(staffPermissions)('%s', async (permission) => {
    body.mockClear()
    const result = await run(`{ ${fieldName(permission)} }`, contextFor(staffAs(role)))
    if (roleHas(role, permission)) {
      expect(result.errors).toBeUndefined()
      expect(body).toHaveBeenCalledOnce()
    } else {
      expect(codeOf(result)).toBe('FORBIDDEN')
      expect(body).not.toHaveBeenCalled()
    }
  })
})

describe('refusals', () => {
  it('a signed-out caller gets UNAUTHENTICATED and the body never runs', async () => {
    body.mockClear()
    expect(codeOf(await run('{ partners_read }', contextFor(null)))).toBe('UNAUTHENTICATED')
    expect(codeOf(await run('{ whoami }', contextFor(null)))).toBe('UNAUTHENTICATED')
    expect(body).not.toHaveBeenCalled()
  })

  it('a session field needs a session and nothing more', async () => {
    expect((await run('{ whoami }', contextFor(staffAs('staff-read-only')))).errors).toBeUndefined()
  })

  it('FORBIDDEN reads the same whether or not the target exists', async () => {
    const pm = staffAs('staff-partner-manager')
    const unassigned = await run('{ partner(id: "partner-b") }', contextFor(pm, ['partner-a']))
    const missing = await run('{ partner(id: "no-such-partner") }', contextFor(pm, ['partner-a']))
    expect(codeOf(unassigned)).toBe('FORBIDDEN')
    expect(JSON.stringify(missing)).toBe(JSON.stringify(unassigned).replace('partner-b', 'no-such-partner'))
    expect(JSON.stringify(unassigned)).not.toContain('partner-b')
  })

  it('a Partner manager acts on an assigned partner; other roles are not held to assignment', async () => {
    const assigned = await run('{ partner(id: "partner-a") }', contextFor(staffAs('staff-partner-manager'), ['partner-a']))
    expect(assigned.errors).toBeUndefined()
    const superAdmin = await run('{ partner(id: "partner-b") }', contextFor(staffAs('staff-super-admin')))
    expect(superAdmin.errors).toBeUndefined()
  })

  it('a refused object field reads as null and the query still succeeds', async () => {
    const support = await run('{ customer { email } }', contextFor(staffAs('staff-support')))
    expect(support).toEqual({ data: { customer: { email: 'shopper@example.com' } } })
    const readOnly = await run('{ customer { email } }', contextFor(staffAs('staff-read-only')))
    expect(readOnly).toEqual({ data: { customer: { email: null } } })
  })

  it('me is null when signed out, not an error', async () => {
    const result = await graphql({ schema: adminSchema, source: '{ me { id } }', contextValue: contextFor(null) })
    expect(result).toEqual({ data: { me: null } })
  })
})
