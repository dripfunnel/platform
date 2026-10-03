import SchemaBuilder from '@pothos/core'
import { graphql } from 'graphql'
import { describe, expect, it } from 'vitest'
import type { PartnerCaller } from '#auth/partnerCaller'
import type { PartnerRole } from '#auth/partnerPermissions'
import { secureSchema } from '../graphql/scope'
import { platformPolicy, type PlatformContext } from './access'

const callerAs = (role: PartnerRole): PartnerCaller => ({
  user: { id: 'pu', name: 'Maya', email: 'maya@example.com', role },
  partner: { id: 'p', name: 'Northstar', product: 'Northstar Shops', host: null, state: 'live' },
})

const schemaWith = (permission: string) => {
  const builder = new SchemaBuilder<{ Context: PlatformContext }>({})
  builder.queryType({
    fields: (t) => ({
      field: t.string({
        nullable: true,
        // A string, so a staff permission can be declared and the build seen to refuse it.
        extensions: { access: { api: 'platform', scope: 'partner', permission: permission as 'stores.create', target: 'none' } },
        resolve: () => 'ok',
      }),
    }),
  })
  return secureSchema(builder.toSchema(), platformPolicy)
}

const codeOf = async (caller: PartnerCaller | null) => {
  const result = await graphql({ schema: schemaWith('stores.create'), source: '{ field }', contextValue: { caller } })
  return result.errors?.[0]?.extensions['code'] ?? result.data?.['field']
}

describe('the Platform API policy', () => {
  it('lets a role with the permission through, refuses one without, and asks a stranger to sign in', async () => {
    expect(await codeOf(callerAs('partner-admin'))).toBe('ok')
    expect(await codeOf(callerAs('partner-support'))).toBe('FORBIDDEN')
    expect(await codeOf(null)).toBe('UNAUTHENTICATED')
  })

  it('refuses at build a field that declares a staff permission', () => {
    expect(() => schemaWith('partners.pause')).toThrow('not a platform API permission')
  })
})
