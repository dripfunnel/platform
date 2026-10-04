import { ZodError } from 'zod'
import { parseConfig } from '#core/config'
import { assertLoopbackOnly } from '../migrate/host-guard'
import { error, warning, type Finding } from './finding'

type Env = Record<string, string | undefined>

const REQUIRED = ['DATABASE_URL', 'CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE', 'ADMIN_HOST', 'PLATFORM_HOST', 'HOOKS_HOST'] as const

// Set together or not at all: the Worker turns each feature on only when its whole group is present.
const GROUPS = [
  { feature: 'Microsoft sign-in', keys: ['ENTRA_TENANT_ID', 'ENTRA_CLIENT_ID', 'ENTRA_CLIENT_SECRET'] },
  { feature: 'Stripe billing', keys: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'] },
  { feature: 'email', keys: ['SES_REGION', 'SES_ACCESS_KEY_ID', 'SES_SECRET_ACCESS_KEY', 'SES_SENDER_DOMAIN'] },
  { feature: 'bounce handling', keys: ['SES_EVENTS_TOPIC_ARN'] },
] as const

const isPlaceholder = (value: string) => /dummy/i.test(value) || /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(value)

const COPY_EXAMPLE = 'cp apps/api/.env.example apps/api/.env.local, then point DATABASE_URL at your local Postgres (docs/api/README.md §7)'

const sameDatabase = (a: URL, b: URL) => a.hostname === b.hostname && (a.port || '5432') === (b.port || '5432') && a.pathname === b.pathname

export const checkEnv = (env: Env, envFileExists: boolean): Finding[] => {
  const missing = REQUIRED.filter((key) => !env[key])
  if (missing.length > 0) {
    return envFileExists
      ? [error(`apps/api/.env.local is missing ${missing.join(', ')}.`, 'Copy those lines from apps/api/.env.example and fill them in.')]
      : [error('apps/api/.env.local does not exist.', COPY_EXAMPLE)]
  }
  const findings: Finding[] = []

  try {
    parseConfig(env)
  } catch (cause) {
    if (!(cause instanceof ZodError)) throw cause
    for (const issue of cause.issues) findings.push(error(`${issue.path.join('.')}: ${issue.message}.`, 'Fix the value in apps/api/.env.local.'))
  }

  const localUrl = (key: 'DATABASE_URL' | 'CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE'): URL | undefined => {
    const value = env[key] ?? ''
    try {
      assertLoopbackOnly(value)
      return new URL(value)
    } catch (cause) {
      findings.push(error(`${key}: ${(cause as Error).message}`, 'Point it at your local Postgres (AGENTS.md rule 3).'))
      return undefined
    }
  }
  const database = localUrl('DATABASE_URL')
  const hyperdrive = localUrl('CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE')
  if (hyperdrive && !hyperdrive.password) {
    findings.push(
      error(
        'CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE has no password, and wrangler refuses it.',
        'Add any password, e.g. postgres://user:local@localhost:5432/dripfunnel; a trust-auth Postgres ignores it.',
      ),
    )
  }
  if (database && hyperdrive && !sameDatabase(database, hyperdrive)) {
    findings.push(
      error(
        'DATABASE_URL and CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE name different databases, so the scripts and the Worker would disagree.',
        'Give both the same host, port and database name.',
      ),
    )
  }

  for (const { feature, keys } of GROUPS) {
    const set = keys.filter((key) => env[key])
    if (set.length > 0 && set.length < keys.length) {
      const unset = keys.filter((key) => !env[key])
      findings.push(warning(`${feature} stays off: ${unset.join(', ')} not set.`, `Set all of ${keys.join(', ')}, or none.`))
    }
    const placeholders = keys.filter((key) => isPlaceholder(env[key] ?? ''))
    if (placeholders.length > 0) {
      findings.push(
        warning(
          `${placeholders.join(', ')} ${placeholders.length === 1 ? 'is' : 'are'} still the placeholder from .env.example, so ${feature} will fail.`,
          'Put the real values in apps/api/.env.local (THIRD-PARTY-ACCESS.md §8), or delete those lines.',
        ),
      )
    }
  }
  return findings
}
