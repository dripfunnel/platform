/**
 * ACCESS.md §4: the redirect after sign-in is a path on this host, never a protocol-relative or
 * absolute address, which the URL parser would send elsewhere. Checked on the server too.
 */
export const safeNext = (next: unknown, origin: string, fallback = '/dashboard'): string => {
  if (typeof next !== 'string' || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback
  try {
    const url = new URL(next, origin)
    return url.origin === origin ? `${url.pathname}${url.search}${url.hash}` : fallback
  } catch {
    return fallback
  }
}
