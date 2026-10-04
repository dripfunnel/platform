import SchemaBuilder from '@pothos/core'
import { graphql } from 'graphql'
import { describe, expect, it } from 'vitest'
import type { PartnerCaller } from '#auth/partnerCaller'
import type { PartnerRole } from '#auth/partnerPermissions'
import { secureSchema } from '../graphql/scope'
import { platformPolicy, type PlatformContext } from './access'

const callerAs = (role: PartnerRole, session: 'impersonation' | 'setup' | null = null): PartnerCaller => ({
  role,
  user: session === 'setup' ? null : { id: 'pu', name: 'Maya', email: 'maya@example.com' },
  staff: session ? { id: 'st', name: 'Priya', email: 'priya@example.com', session: { kind: session, id: 's', expiresAt: new Date() } } : null,
  partner: { id: 'p', name: 'Northstar', product: 'Northstar Shops', host: null, state: 'live' },
})

const schemaWith = (permission: string, blockedFor?: readonly ('impersonation' | 'setup')[]) => {
  const builder = new SchemaBuilder<{ Context: PlatformContext }>({})
  builder.queryType({
    fields: (t) => ({
      field: t.string({
        nullable: true,
        // A string, so a staff permission can be declared and the build seen to refuse it.
        extensions: { access: { api: 'platform', scope: 'partner', permission: permission as 'stores.create', target: 'none', ...(blockedFor ? { blockedFor } : {}) } },
        resolve: () => 'ok',
      }),
    }),
  })
  return secureSchema(builder.toSchema(), platformPolicy)
}

const codeOf = async (caller: PartnerCaller | null, blockedFor?: readonly ('impersonation' | 'setup')[]) => {
  const result = await graphql({ schema: schemaWith('stores.create', blockedFor), source: '{ field }', contextValue: { caller } })
  return result.errors?.[0]?.extensions['code'] ?? result.data?.['field']
}

describe('the Platform API policy', () => {
  it('lets a role with the permission through, refuses one without, and asks a stranger to sign in', async () => {
    expect(await codeOf(callerAs('partner-admin'))).toBe('ok')
    expect(await codeOf(callerAs('partner-support'))).toBe('FORBIDDEN')
    expect(await codeOf(null)).toBe('UNAUTHENTICATED')
  })

  it('refuses a staff session a field blocked for its kind, with its own code, whatever the role', async () => {
    expect(await codeOf(callerAs('partner-owner', 'impersonation'), ['impersonation'])).toBe('BLOCKED_WHILE_IMPERSONATING')
    expect(await codeOf(callerAs('partner-owner', 'setup'), ['setup'])).toBe('PARTNER_ENTERS_THIS_ITSELF')
    expect(await codeOf(callerAs('partner-owner', 'setup'), ['impersonation'])).toBe('ok')
    expect(await codeOf(callerAs('partner-owner'), ['impersonation', 'setup'])).toBe('ok')
  })

  it('refuses at build a field that declares a staff permission', () => {
    expect(() => schemaWith('partners.pause')).toThrow('not a platform API permission')
  })
})
