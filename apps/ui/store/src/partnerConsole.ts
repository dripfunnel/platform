export interface PartnerConsoleEnv {
  DEV: boolean
  VITE_PLATFORM_URL?: unknown
}

export const devPartnerConsoleUrl = 'http://localhost:5174'
// `pnpm dev:https` serves the console behind Caddy (docs/setup/local.md), where the agent is signed in.
export const caddyPartnerConsoleUrl = 'https://platform.localhost'

export const productionPartnerConsoleUrl = 'https://platform.dripfunnel.ai'

// Where the agent goes when its session is over (#1112): under vite dev the console beside this
// portal, otherwise the build's VITE_PLATFORM_URL (https only) or production.
export const partnerConsoleUrlFor = (env: PartnerConsoleEnv, host = ''): string => {
  if (env.DEV) return host.endsWith('.localhost') ? caddyPartnerConsoleUrl : devPartnerConsoleUrl
  const built = env.VITE_PLATFORM_URL
  return typeof built === 'string' && built.startsWith('https://') ? built : productionPartnerConsoleUrl
}

export const partnerConsoleUrl = partnerConsoleUrlFor(import.meta.env, typeof location === 'undefined' ? '' : location.hostname)
