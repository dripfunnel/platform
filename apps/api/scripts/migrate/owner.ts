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
  const tables = await sql<{ rolname: string; relname: string }[]>`
    select r.rolname, c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_roles r on r.oid = c.relowner
    where n.nspname = current_schema() and c.relkind in ('r', 'p')
    order by r.rolname, c.relname
  `
  const names = [...new Set(tables.map((t) => t.rolname))].sort()
  if (names.length === 0 || (names.length === 1 && names[0] === connectedAs)) return { connectedAs, runAs: null }
  if (names.length > 1) {
    // The statements that end the split, run by each other owner, so nobody has to derive them.
    const byOwner = names.map((name) => `${name} (${tables.filter((t) => t.rolname === name).map((t) => t.relname).join(', ')})`)
    const handOver = tables
      .filter((t) => t.rolname !== connectedAs)
      .map((t) => `alter table ${quoteIdentifier(t.relname)} owner to ${quoteIdentifier(connectedAs)};`)
    throw new Error(
      [
        `The tables in schema ${await schemaName(sql)} are owned by ${byOwner.join('; ')}; migrations need one owner.`,
        `Connected as ${connectedAs}. To make it the owner, run as each other owner (after grant ${quoteIdentifier(connectedAs)} to that owner):`,
        ...handOver,
      ].join('\n'),
    )
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
