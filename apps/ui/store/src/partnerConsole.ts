export interface PartnerConsoleEnv {
  DEV: boolean
  VITE_PLATFORM_URL?: unknown
}

export const productionPartnerConsoleUrl = 'https://platform.dripfunnel.ai'

// Where a support link that no longer works sends the agent (#1112): the partner console's dev port
// under vite dev, otherwise the build's VITE_PLATFORM_URL (https only) or production.
export const partnerConsoleUrlFor = (env: PartnerConsoleEnv): string => {
  if (env.DEV) return 'http://localhost:5174'
  const built = env.VITE_PLATFORM_URL
  return typeof built === 'string' && built.startsWith('https://') ? built : productionPartnerConsoleUrl
}

export const partnerConsoleUrl = partnerConsoleUrlFor(import.meta.env)
