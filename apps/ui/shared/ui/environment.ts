export type Environment = 'prod' | 'dev' | 'feature' | 'local'

const production = new Set(['admin.dripfunnel.com', 'platform.dripfunnel.com'])
const dev = new Set(['dev-admin.dripfunnel.ai', 'dev-platform.dripfunnel.ai'])
const local = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

// The four environments by hostname (ARCHITECTURE.md §6; decided on #65). Only the two exact
// production hosts are prod: a look-alike or an unknown host is treated as a feature environment.
export const environmentFor = (hostname: string): Environment => {
  const host = hostname.toLowerCase()
  if (production.has(host)) return 'prod'
  if (dev.has(host)) return 'dev'
  if (local.has(host) || host.endsWith('.localhost')) return 'local'
  return 'feature'
}
