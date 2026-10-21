export interface AdminUrlEnv {
  DEV: boolean
  VITE_ADMIN_URL?: unknown
}

export const productionAdminUrl = 'https://admin.dripfunnel.com'

// Where a portal's staff-session links lead: the admin console's dev port under vite dev,
// otherwise the build's VITE_ADMIN_URL (https only, e.g. a feature environment) or production.
export const adminConsoleUrlFor = (env: AdminUrlEnv): string => {
  if (env.DEV) return 'http://localhost:5175'
  const built = env.VITE_ADMIN_URL
  return typeof built === 'string' && built.startsWith('https://') ? built : productionAdminUrl
}
