import { existsSync, readdirSync } from 'node:fs'
import postgres from 'postgres'
import { withSystemScope } from '#db/scoped/index'
import { pendingMigrations } from '../migrate/pending'
import { assertPostgresMajor, REQUIRED_POSTGRES_MAJOR } from '../migrate/version-check'
import { error, warning, type Finding } from './finding'

// Homebrew keeps postgresql@18 off PATH, so its tools are named by full path when found.
const pgTool = (name: string) => {
  const dir = [`/opt/homebrew/opt/postgresql@${REQUIRED_POSTGRES_MAJOR}/bin`, `/usr/local/opt/postgresql@${REQUIRED_POSTGRES_MAJOR}/bin`].find((d) => existsSync(d))
  return dir ? `${dir}/${name}` : name
}

const describeTarget = (url: URL) => {
  const port = url.port || '5432'
  return { port, where: `${url.hostname}:${port}`, database: url.pathname.slice(1), user: decodeURIComponent(url.username) || 'your user' }
}

// An AggregateError (one attempt per resolved address) has an empty message of its own (#341).
const reason = (cause: unknown): string => {
  const { message, code, errors } = cause as { message?: string; code?: string; errors?: unknown[] }
  const inner = errors?.map((e) => (e as Error).message).filter(Boolean).join('; ')
  return message || inner || code || 'unknown error'
}

export const connectionFinding = (cause: unknown, url: URL): Finding => {
  const { port, where, database, user } = describeTarget(url)
  const code = (cause as { code?: string }).code
  switch (code) {
    case 'ECONNREFUSED':
    case 'CONNECT_TIMEOUT':
      return error(
        `Postgres isn't answering on ${where}.`,
        `Start it (brew services start postgresql@${REQUIRED_POSTGRES_MAJOR}), or fix the port in apps/api/.env.local if it runs elsewhere.`,
      )
    case '3D000':
      return error(`Postgres is running, but database "${database}" doesn't exist.`, `${pgTool('createdb')} -p ${port} -O ${user} ${database}`)
    case '28000':
      return error(`Postgres has no role "${user}".`, `${pgTool('createuser')} -p ${port} -s ${user}`)
    case '28P01':
      return error(`Postgres refused the password for "${user}".`, 'Fix the password in DATABASE_URL in apps/api/.env.local.')
    default:
      return error(`Can't connect to Postgres on ${where}: ${reason(cause)}`, 'Check DATABASE_URL in apps/api/.env.local (docs/api/README.md §7).')
  }
}

/** `full` also wants every migration applied and the seed loaded; `setup` runs those itself next. */
export const checkDatabase = async (connectionString: string, migrationsDir: string, mode: 'full' | 'setup'): Promise<Finding[]> => {
  const url = new URL(connectionString)
  const sql = postgres(connectionString, { max: 1, connect_timeout: 5, onnotice: () => undefined })
  try {
    let versionNum: string
    try {
      ;[{ server_version_num: versionNum }] = await sql<[{ server_version_num: string }]>`select current_setting('server_version_num') as server_version_num`
    } catch (cause) {
      return [connectionFinding(cause, url)]
    }
    try {
      assertPostgresMajor(Number(versionNum))
    } catch (cause) {
      return [error((cause as Error).message, `brew install postgresql@${REQUIRED_POSTGRES_MAJOR}, run it on its own port and point DATABASE_URL at it.`)]
    }
    if (mode === 'setup') return []

    const [{ exists }] = await sql<[{ exists: boolean }]>`select to_regclass('schema_migrations') is not null as exists`
    const applied = exists ? await sql<{ name: string }[]>`select name from schema_migrations` : []
    const pending = pendingMigrations(readdirSync(migrationsDir), new Set(applied.map((row) => row.name)))
    if (pending.length > 0) {
      return [error(`${pending.length} migration(s) not applied, starting with ${pending[0]}.`, 'pnpm setup:local (or pnpm --filter ./apps/api migrate)')]
    }

    const [{ seeded }] = await withSystemScope(sql, (tx) => tx<[{ seeded: boolean }]>`select exists (select 1 from staff_user) as seeded`)
    return seeded ? [] : [warning('The database has no sample data, so there is nobody to sign in as.', 'pnpm --filter ./apps/api seed')]
  } finally {
    await sql.end()
  }
}
