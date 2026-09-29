const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])
const OVERRIDE_PARAMS = ['host', 'hostaddr']

const normalizeHostname = (hostname: string): string => hostname.replace(/^\[(.+)\]$/, '$1')

export const assertLocalHost = (connectionString: string): void => {
  let url: URL
  try {
    url = new URL(connectionString)
  } catch {
    throw new Error('DATABASE_URL is not a valid URL.')
  }
  const hostname = normalizeHostname(url.hostname)
  if (!LOCAL_HOSTS.has(hostname)) {
    throw new Error(`Refusing to run migrations against non-local host "${hostname}". Local databases only.`)
  }
  for (const param of OVERRIDE_PARAMS) {
    if (url.searchParams.has(param)) {
      throw new Error(`Refusing to run migrations: connection string sets "${param}", which can override the host. Local databases only.`)
    }
  }
}
