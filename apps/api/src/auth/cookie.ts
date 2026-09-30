import { absoluteMs, cookieName } from './session'

// `__Host-` requires Secure, Path=/ and no Domain, which is what pins the cookie to the admin
// host alone (ACCESS.md §4). `Max-Age` matches the absolute bound; the server still decides.
export const setCookie = (id: string): string =>
  `${cookieName}=${id}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(absoluteMs / 1000)}`

export const clearCookie = (): string => `${cookieName}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`

export const readCookie = (header: string | null): string | null => {
  if (!header) return null
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === cookieName) return rest.join('=') || null
  }
  return null
}

/**
 * ACCESS.md §4: SameSite=Lax plus an Origin check on every mutation. Lax alone still admits
 * top-level cross-site POSTs in some browsers, so the Origin is what actually decides.
 */
export const originAllowed = (request: Request, adminHost: string): boolean => {
  if (request.method === 'GET' || request.method === 'HEAD') return true
  const origin = request.headers.get('origin')
  if (!origin) return false
  try {
    return new URL(origin).host === adminHost
  } catch {
    return false
  }
}
