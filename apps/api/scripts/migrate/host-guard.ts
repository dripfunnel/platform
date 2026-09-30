const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])
const OVERRIDE_PARAMS = ['host', 'hostaddr']

const normalizeHostname = (hostname: string): string => hostname.replace(/^\[(.+)\]$/, '$1')

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
  if (remoteBypassRequested) {
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
  } else if (!LOCAL_HOSTS.has(hostname)) {
    throw new Error(`Refusing to run migrations against non-local host "${hostname}". Local databases only.`)
  }
  for (const param of OVERRIDE_PARAMS) {
    if (url.searchParams.has(param)) {
      throw new Error(`Refusing to run migrations: connection string sets "${param}", which can override the host. Local databases only.`)
    }
  }
}
