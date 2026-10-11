// A request path to the object it names inside one build or preview folder (storefront LIVE-SHOP.md §5 step 4). The folder
// always comes from the hostname's store; the path only ever adds plain names below it (LIVE-SHOP §9).

const plainName = /^[A-Za-z0-9._~@+,=-]{1,200}$/

/** The key under the folder, or null for a path that isn't plain names (`..`, an encoded slash, a control character). */
export const relativeKey = (pathname: string): string | null => {
  const parts = pathname.split('/').slice(1)
  const trailing = parts.at(-1) === ''
  if (trailing) parts.pop()
  const names: string[] = []
  for (const part of parts) {
    let name: string
    try {
      name = decodeURIComponent(part)
    } catch {
      return null
    }
    if (!plainName.test(name) || name === '.' || name === '..') return null
    names.push(name)
  }
  const last = names.at(-1)
  if (last === undefined) return 'index.html'
  if (trailing || !last.includes('.')) return [...names, 'index.html'].join('/')
  return names.join('/')
}

/** A path naming a file of its own (a chunk, an image, a JSON file), not a page. */
export const isFilePath = (pathname: string): boolean => {
  const last = pathname.split('/').at(-1) ?? ''
  return last.includes('.') && !last.endsWith('.html')
}

/** The headers the build gave the file (its type, cache rules and CSP), set when it was copied in (LIVE-SHOP §4 step 9). */
export const fileHeaders = (object: R2Object): Headers => {
  const headers = new Headers()
  headers.set('content-type', object.httpMetadata?.contentType ?? 'application/octet-stream')
  if (object.httpMetadata?.cacheControl) headers.set('cache-control', object.httpMetadata.cacheControl)
  const csp = object.customMetadata?.['csp']
  if (csp) headers.set('content-security-policy', csp)
  headers.set('x-content-type-options', 'nosniff')
  headers.set('etag', object.httpEtag)
  return headers
}
