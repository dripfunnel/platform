// The Trusted Types policies of storefront ARCHITECTURE §3.5. TypeScript's DOM library doesn't
// describe Trusted Types yet, so this is the part of it core uses.
type Policy = { createScriptURL: (url: string) => unknown }
type Factory = { createPolicy: (name: string, rules: { createScriptURL: (url: string) => string }) => Policy }

let core: Policy | undefined

const allowed = (url: string, hosts: readonly string[], origins: readonly string[]): boolean => {
  try {
    const u = new URL(url, globalThis.location?.href)
    return (u.protocol === 'https:' && hosts.includes(u.host)) || origins.includes(u.origin)
  } catch {
    return false
  }
}

const only = (hosts: readonly string[], origins: readonly string[]) => (url: string) => {
  if (!allowed(url, hosts, origins)) throw new TypeError(`Not a script this store loads: ${url}`)
  return url
}

/**
 * Creates `df-core`, for core's own analytics scripts, and the narrow `default`, which a provider's plain
 * string meets: a script URL only on the store's analytics hosts or the build's own origins. Once, before any script loads.
 */
export const installTrustedTypes = ({ analyticsHosts, buildOrigins }: { analyticsHosts: readonly string[]; buildOrigins: readonly string[] }) => {
  const factory = (globalThis as { trustedTypes?: Factory }).trustedTypes
  if (!factory || core) return
  core = factory.createPolicy('df-core', { createScriptURL: only(analyticsHosts, []) })
  factory.createPolicy('default', { createScriptURL: only(analyticsHosts, buildOrigins) })
}

/** Sets a script's address through `df-core` where Trusted Types are on. */
export const setScriptSrc = (script: HTMLScriptElement, url: string) => {
  Reflect.set(script, 'src', core ? core.createScriptURL(url) : url)
}
