// The redirect after sign-in is same-origin only (ACCESS §4): a path on this host, never a
// protocol-relative or absolute address, which the URL parser would send elsewhere.
export const safeNext = (next: unknown, origin: string, fallback: string): string => {
  if (typeof next !== 'string' || !next.startsWith('/') || next.startsWith('//')) return fallback
  try {
    const url = new URL(next, origin)
    return url.origin === origin ? `${url.pathname}${url.search}${url.hash}` : fallback
  } catch {
    return fallback
  }
}
