import { describe, expect, it } from 'vitest'
import { checkEnv } from './env'

const url = 'postgres://dripfunnel_dev:dripfunnel_dev@localhost:5432/dripfunnel'
const ready = {
  DATABASE_URL: url,
  CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: url,
  ADMIN_HOST: 'admin.localhost',
  PLATFORM_HOST: 'platform.localhost',
  HOOKS_HOST: 'hooks.localhost',
}
const problems = (env: Record<string, string | undefined>, fileExists = true) => checkEnv(env, fileExists).map((f) => `${f.level}: ${f.problem}`)

describe('checkEnv', () => {
  it('passes a complete local file', () => {
    expect(checkEnv(ready, true)).toEqual([])
  })

  it('says to create .env.local when there is none', () => {
    expect(checkEnv({}, false)).toEqual([expect.objectContaining({ level: 'error', problem: 'apps/api/.env.local does not exist.' })])
  })

  it('names the missing keys when the file exists', () => {
    expect(problems({ ...ready, ADMIN_HOST: undefined, HOOKS_HOST: '' })).toEqual(['error: apps/api/.env.local is missing ADMIN_HOST, HOOKS_HOST.'])
  })

  it('refuses a remote database', () => {
    expect(problems({ ...ready, DATABASE_URL: 'postgres://u:p@dbpg01.softobotics.org:5432/dripfunnel' })).toContainEqual(
      expect.stringMatching(/^error: DATABASE_URL: Refusing to run against non-local host "dbpg01\.softobotics\.org"/),
    )
  })

  it('reports each connection string on its own', () => {
    const found = problems({
      ...ready,
      DATABASE_URL: 'postgres://u@dbpg01.softobotics.org/dripfunnel',
      CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: 'postgres://dripfunnel_dev@localhost:5432/dripfunnel',
    })
    expect(found).toHaveLength(2)
    expect(found).toContainEqual(expect.stringMatching(/has no password/))
  })

  it('wants a password on the Hyperdrive string and the same database in both', () => {
    const found = problems({ ...ready, CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: 'postgres://dripfunnel_dev@localhost:5434/dripfunnel' })
    expect(found).toContainEqual(expect.stringMatching(/has no password/))
    expect(found).toContainEqual(expect.stringMatching(/name different databases/))
  })

  it('reports a value the Worker would reject', () => {
    expect(problems({ ...ready, STRIPE_SECRET_KEY: 'nope', STRIPE_WEBHOOK_SECRET: 'whsec_abc' })).toContainEqual(
      'error: STRIPE_SECRET_KEY: STRIPE_SECRET_KEY must be a Stripe secret or restricted key.',
    )
  })

  it('warns about a half-configured feature and placeholder values', () => {
    const found = problems({ ...ready, ENTRA_TENANT_ID: '00000000-0000-0000-0000-000000000000', ENTRA_CLIENT_ID: 'real-client-id' })
    expect(found).toEqual([
      'warning: Microsoft sign-in stays off: ENTRA_CLIENT_SECRET not set.',
      'warning: ENTRA_TENANT_ID is still the placeholder from .env.example, so Microsoft sign-in will fail.',
    ])
  })

  it('takes the email stand-in with the suppression key alone, and still warns of a half-set SES without it', () => {
    const key = `${'A'.repeat(43)}=`
    expect(checkEnv({ ...ready, EMAIL_LOCAL: '1', SMS_LOCAL: '1', DNS_LOCAL: '1', EMAIL_SUPPRESSION_KEY: key }, true)).toEqual([])
    expect(problems({ ...ready, EMAIL_SUPPRESSION_KEY: key })).toEqual([expect.stringMatching(/^warning: email stays off/)])
  })
})

