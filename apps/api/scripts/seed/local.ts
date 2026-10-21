import postgres from 'postgres'
import { hashPassword, minPasswordLength } from '#auth/password'
import { assertLoopbackOnly } from '../migrate/host-guard'

// The seed's local finish (docs/setup/local.md §5): run by `pnpm --filter ./apps/api seed`, never by the tests, which keep
// the sample's .example hosts.

export interface LocalFinish {
  hosts: number
  passwords: number
}

export const localHost = (host: string): string => host.replace(/\.example$/, '.localhost')

export const finishLocally = async (connectionString: string, password: string | undefined): Promise<LocalFinish> => {
  assertLoopbackOnly(connectionString)
  if (password !== undefined && password.length < minPasswordLength) throw new Error(`SEED_PASSWORD needs at least ${minPasswordLength} characters, as any password does.`)
  const sql = postgres(connectionString, { max: 1 })
  try {
    return await sql.begin(async (tx) => {
      const hosts = await tx`update partner_domain set host = regexp_replace(host, '\\.example$', '.localhost') where host like '%.example' returning id`
      await tx`update partner_domain_record set name = regexp_replace(name, '\\.example$', '.localhost') where name like '%.example'`
      await tx`update partner_setup_item set detail = regexp_replace(detail, '\\.example\\M', '.localhost', 'g') where item in ('portalHost', 'emailSender') and detail is not null`
      if (password === undefined) return { hosts: hosts.length, passwords: 0 }
      const hash = await hashPassword(password)
      const people = await tx`update "user" set password_hash = ${hash} where status = 'active' returning id`
      const partnerUsers = await tx`update partner_user set password_hash = ${hash} where status = 'active' returning id`
      return { hosts: hosts.length, passwords: people.length + partnerUsers.length }
    })
  } finally {
    await sql.end()
  }
}
