import type { SitesBucket } from '#saas/storefronts/index'

// The storefront sites bucket in memory, for the create-storefront tests: R2's put refuses bytes whose SHA-256 isn't
// the one it was given, and answers with the checksum it stored.

export interface FakeSites extends SitesBucket {
  objects: Map<string, { bytes: Uint8Array; contentType?: string | undefined; uploaded: Date }>
  /** The next `times` puts under `prefix` answer without a checksum, as a copy R2 didn't confirm. */
  unconfirmed: (prefix: string, times?: number) => void
  keys: (prefix: string) => string[]
  /** Dates every object under `prefix` as uploaded at `at`. */
  age: (prefix: string, at: Date) => void
}

const sha256 = async (bytes: ArrayBuffer | Uint8Array<ArrayBuffer>) => crypto.subtle.digest('SHA-256', bytes)
const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('')

export const fakeSites = (): FakeSites => {
  const objects = new Map<string, { bytes: Uint8Array; contentType?: string | undefined; uploaded: Date }>()
  const failing: { prefix: string; times: number }[] = []
  return {
    objects,
    unconfirmed: (prefix, times = 1) => {
      failing.push({ prefix, times })
    },
    keys: (prefix) => [...objects.keys()].filter((k) => k.startsWith(prefix)).sort(),
    age: (prefix, at) => {
      for (const [key, object] of objects) if (key.startsWith(prefix)) object.uploaded = at
    },
    get: async (key) => {
      const found = objects.get(key)
      if (!found) return null
      const copy = found.bytes.slice()
      return { text: async () => new TextDecoder().decode(copy), arrayBuffer: async () => copy.buffer, ...(found.contentType ? { httpMetadata: { contentType: found.contentType } } : {}) }
    },
    put: async (key, value, options) => {
      const digest = await sha256(value)
      if (hex(digest) !== options.sha256) throw new Error('put: The SHA-256 checksum you specified did not match what we received.')
      const failure = failing.find((f) => f.times > 0 && key.startsWith(f.prefix))
      objects.set(key, { bytes: new Uint8Array(value.slice(0)), contentType: options.httpMetadata?.contentType, uploaded: new Date() })
      if (failure) {
        failure.times -= 1
        return { checksums: {} }
      }
      return { checksums: { sha256: digest } }
    },
    // Two at a time, as pages, so every caller is tested across several.
    list: async ({ prefix, cursor }) => {
      const all = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort()
      const from = cursor ? all.findIndex((k) => k > cursor) : 0
      const keys = from < 0 ? [] : all.slice(from, from + 2)
      const last = keys.at(-1)
      const truncated = last !== undefined && all.indexOf(last) < all.length - 1
      return { objects: keys.map((key) => ({ key, uploaded: objects.get(key)?.uploaded ?? new Date() })), truncated, ...(truncated && last ? { cursor: last } : {}) }
    },
    delete: async (keys) => {
      for (const key of keys) objects.delete(key)
    },
  }
}

/** Puts a JSON or text file as the release workflow would. */
export const putText = async (sites: FakeSites, key: string, text: string, contentType?: string) => {
  const bytes = new TextEncoder().encode(text)
  await sites.put(key, bytes.buffer, { sha256: hex(await sha256(bytes)), ...(contentType ? { httpMetadata: { contentType } } : {}) })
  return hex(await sha256(bytes))
}
