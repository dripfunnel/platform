const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])
const OVERRIDE_PARAMS = ['host', 'hostaddr']

const normalizeHostname = (hostname: string): string => hostname.replace(/^\[(.+)\]$/, '$1')

/**
 * Loopback or nothing: no CI opt-in, unlike `assertLocalHost`. For tooling that destroys data,
 * such as the seed, which must never reach the dev or prod database however the shell is set.
 */
export const assertLoopbackOnly = (connectionString: string): void => {
  let url: URL
  try {
    url = new URL(connectionString)
  } catch {
    throw new Error('DATABASE_URL is not a valid URL.')
  }
  const hostname = normalizeHostname(url.hostname)
  if (!LOCAL_HOSTS.has(hostname)) throw new Error(`Refusing to run against non-local host "${hostname}". Local databases only.`)
  for (const param of OVERRIDE_PARAMS) {
    if (url.searchParams.has(param)) throw new Error(`Refusing to run: connection string sets "${param}", which can override the host. Local databases only.`)
  }
}

export const assertLocalHost = (connectionString: string): void => {
  const remoteBypassRequested = process.env.ALLOW_REMOTE_MIGRATIONS === '1' && process.env.CI === 'true'
  const allowedRemoteHost = process.env.ALLOWED_MIGRATION_HOST?.trim().toLowerCase()
  let url: URL
  try {
    url = new URL(connectionString)
  } catch {
    throw new Error('DATABASE_URL is not a valid URL.')
  }
  const hostname = normalizeHostname(url.hostname)
  // A local host is always allowed, opt-in or not. The opt-in names one remote host; it must
  // not make localhost fail the match, or turning it on for a whole CI step would refuse the
  // local database every other test uses.
  if (!LOCAL_HOSTS.has(hostname)) {
    if (!remoteBypassRequested) {
      throw new Error(`Refusing to run migrations against non-local host "${hostname}". Local databases only.`)
    }
    if (!allowedRemoteHost) {
      throw new Error(
        `ALLOW_REMOTE_MIGRATIONS=1 but ALLOWED_MIGRATION_HOST is not set. Refusing to run migrations against "${hostname}".`,
      )
    }
    if (hostname !== allowedRemoteHost) {
      throw new Error(
        `Refusing to run migrations: host "${hostname}" does not match ALLOWED_MIGRATION_HOST "${allowedRemoteHost}".`,
      )
    }
  }
  for (const param of OVERRIDE_PARAMS) {
    if (url.searchParams.has(param)) {
      throw new Error(`Refusing to run migrations: connection string sets "${param}", which can override the host. Local databases only.`)
    }
  }
}
