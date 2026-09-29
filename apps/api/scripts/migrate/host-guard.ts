const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

export const assertLocalHost = (connectionString: string): void => {
  const { hostname } = new URL(connectionString)
  if (!LOCAL_HOSTS.has(hostname)) {
    throw new Error(`Refusing to run migrations against non-local host "${hostname}". Local databases only.`)
  }
}
