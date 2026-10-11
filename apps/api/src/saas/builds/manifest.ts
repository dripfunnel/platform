import { z } from 'zod'
import { manifestName } from '#saas/storefronts/layout'

// The manifest an upload ends with (storefront LIVE-SHOP.md §4 step 8): every built file with its SHA-256 and size, and
// an HTML file's headers. Its digest is the check step's (§4 step 7), so the report and the bytes are one.

export const maxBuildFiles = 5_000
export const maxFileBytes = 10 * 1024 * 1024

const segment = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$/
/** Plain relative names: no `..`, no hidden, absolute or empty segment, and never the manifest's own name. */
export const isSitePath = (path: string): boolean => path.length <= 512 && path !== manifestName && path.split('/').every((s) => segment.test(s) && !s.includes('..'))

const sha256 = z.string().regex(/^[0-9a-f]{64}$/)

export const manifestSchema = z
  .strictObject({
    files: z
      .array(
        z.strictObject({
          path: z.string().refine(isSitePath),
          sha256,
          size: z.number().int().min(0).max(maxFileBytes),
          // core's pageHeaders (storefront ARCHITECTURE §3.5); the edge Worker serves no other header from a manifest.
          headers: z.strictObject({ 'content-security-policy': z.string().min(1).max(8_192) }).optional(),
        }),
      )
      .min(1)
      .max(maxBuildFiles),
  })
  .refine((m) => new Set(m.files.map((f) => f.path)).size === m.files.length, 'a path appears twice')
  .refine((m) => m.files.every((f) => f.headers === undefined || f.path.endsWith('.html')), 'headers on a file that is not HTML')

export type Manifest = z.infer<typeof manifestSchema>

const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('')

/**
 * SHA-256 over `<sha256>  <path>\n` for every file, sorted by path, as `sha256sum` prints them (LIVE-SHOP §4 step 7).
 * Paths are ASCII, so code-unit order is byte order.
 */
export const digestOf = async (files: readonly { path: string; sha256: string }[]): Promise<string> => {
  const lines = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)).map((f) => `${f.sha256}  ${f.path}\n`)
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(lines.join(''))))
}
