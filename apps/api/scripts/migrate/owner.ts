import type postgres from 'postgres'

export interface OwnerCheck {
  connectedAs: string
  /** The role each migration runs as, or null when the connecting role already owns the tables. */
  runAs: string | null
}

const quoteIdentifier = (name: string) => `"${name.replaceAll('"', '""')}"`

/**
 * The schema belongs to one role (DATA-MODEL.md §5.3). A connecting role that is a member of
 * that owner runs each migration as it, so the owner stays the owner; any other mismatch stops
 * the run by name, before the first statement, instead of a bare "must be owner" from Postgres.
 */
export const checkOwner = async (sql: postgres.Sql): Promise<OwnerCheck> => {
  const [{ connectedAs }] = await sql<[{ connectedAs: string }]>`select current_user as "connectedAs"`
  const owners = await sql<{ rolname: string }[]>`
    select distinct r.rolname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_roles r on r.oid = c.relowner
    where n.nspname = current_schema() and c.relkind in ('r', 'p')
  `
  const names = owners.map((o) => o.rolname).sort()
  if (names.length === 0 || (names.length === 1 && names[0] === connectedAs)) return { connectedAs, runAs: null }
  if (names.length > 1) {
    throw new Error(`The tables in schema ${await schemaName(sql)} are owned by ${names.join(', ')}; migrations need one owner. Reassign them to one role first.`)
  }
  const owner = names[0] as string
  const [{ member }] = await sql<[{ member: boolean }]>`select pg_has_role(current_user, ${owner}, 'member') as member`
  if (!member) {
    throw new Error(
      `Connected as ${connectedAs}, but the tables are owned by ${owner}, so no migration can run. Either grant the membership (grant ${quoteIdentifier(owner)} to ${quoteIdentifier(connectedAs)}) or connect as ${owner}.`,
    )
  }
  return { connectedAs, runAs: owner }
}

const schemaName = async (sql: postgres.Sql) => (await sql<[{ schema: string }]>`select current_schema() as schema`)[0].schema

/** `set local role` for one migration's transaction; a no-op when the connecting role owns the tables. */
export const setRoleStatement = (check: OwnerCheck): string | null => (check.runAs ? `set local role ${quoteIdentifier(check.runAs)}` : null)
