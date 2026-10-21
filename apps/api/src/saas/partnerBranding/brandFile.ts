// A brand file a partner uploads (card #219): SVG, PNG or WebP, at most 512 KB, its type read
// from the bytes. An SVG that could run anything is refused rather than cleaned (FIRST-RELEASE §8).

export const brandFileKinds = ['logoLight', 'logoDark', 'mark', 'favicon', 'appIcon', 'appIconForeground', 'splash'] as const
export type BrandFileKind = (typeof brandFileKinds)[number]
export const maxBrandFileBytes = 512 * 1024

// The merchant app's images (#495): PNG only, as BUILD-CHECKLIST §2 has them.
const appImages: Partial<Record<BrandFileKind, { side?: number; opaque?: boolean }>> = {
  appIcon: { side: 1024, opaque: true },
  appIconForeground: { side: 1024 },
  splash: {},
}

export const appImageKinds = ['appIcon', 'appIconForeground', 'splash'] as const satisfies readonly BrandFileKind[]

// A mobile app image's name carries its kind, so publish can tell it passed that kind's checks.
export const brandFileKey = (partnerId: string, kind: BrandFileKind, ext: string) =>
  `partners/${partnerId}/brand/${appImages[kind] ? `${kind}-` : ''}${crypto.randomUUID()}.${ext}`

export const uploadedAs = (key: string, partnerId: string, kind: (typeof appImageKinds)[number]) =>
  new RegExp(`^partners/${partnerId}/brand/${kind}-[0-9a-f-]{36}\\.png$`).test(key)

export type BrandFileType = { ext: 'png' | 'webp' | 'svg'; contentType: string }
export type BrandFileRefusal = 'TOO_LARGE' | 'UNSUPPORTED_TYPE' | 'UNSAFE_SVG' | 'NOT_PNG' | 'WRONG_DIMENSIONS' | 'HAS_TRANSPARENCY'
export type BrandFileCheck = { ok: true; type: BrandFileType } | { ok: false; code: BrandFileRefusal }

const startsWith = (bytes: Uint8Array, prefix: readonly number[], at = 0) => prefix.every((b, i) => bytes[at + i] === b)
const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0))

/** The type the bytes are, whatever the request says; null for anything else. */
export const sniffBrandFile = (bytes: Uint8Array): BrandFileType | null => {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { ext: 'png', contentType: 'image/png' }
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) return { ext: 'webp', contentType: 'image/webp' }
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, 1024))
  // An XML declaration, comments and a doctype may come before the root, which must be <svg.
  const root = text.replace(/^\s*(<\?xml[^>]*\?>\s*)?((<!--[\s\S]*?-->|<!DOCTYPE[^>[]*>)\s*)*/i, '')
  return /^<svg[\s>]/i.test(root) ? { ext: 'svg', contentType: 'image/svg+xml' } : null
}

/** A PNG's size and whether it can hold transparency: an alpha channel or a tRNS chunk before the image data. */
export const readPng = (bytes: Uint8Array): { width: number; height: number; transparent: boolean } | null => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const type = (at: number) => String.fromCharCode(...bytes.subarray(at + 4, at + 8))
  if (bytes.byteLength < 33 || type(8) !== 'IHDR') return null
  const colourType = bytes[25]
  let transparent = colourType === 4 || colourType === 6
  for (let at = 33; !transparent && at + 8 <= bytes.byteLength; at += 12 + view.getUint32(at)) {
    const chunk = type(at)
    if (chunk === 'IDAT' || chunk === 'IEND') break
    transparent = chunk === 'tRNS'
  }
  return { width: view.getUint32(16), height: view.getUint32(20), transparent }
}

// Anything that can run script, load a resource or expand entities, under any namespace prefix;
// character references and CSS escapes could spell any of it, so a logo may hold neither.
const unsafeSvg = [
  /<([\w.-]+:)?(script|foreignObject|iframe|embed|object|use|image|feImage|animate|set|handler|listener)[\s>/]/i,
  /<!ENTITY/i,
  /&(?!(amp|lt|gt|quot|apos);)/i,
  /\\/,
  /\son[a-z]+\s*=/i,
  /(href|src)\s*=\s*["']?\s*(?!#)[^\s"'>]/i,
  /javascript:|data:|url\s*\(\s*["']?\s*(?!#)/i,
  /@import/i,
]

export const checkBrandFile = (bytes: Uint8Array, kind: BrandFileKind): BrandFileCheck => {
  if (bytes.byteLength > maxBrandFileBytes) return { ok: false, code: 'TOO_LARGE' }
  const type = sniffBrandFile(bytes)
  const app = appImages[kind]
  if (app) {
    const png = type?.ext === 'png' ? readPng(bytes) : null
    if (!type || !png) return { ok: false, code: 'NOT_PNG' }
    if (app.side && (png.width !== app.side || png.height !== app.side)) return { ok: false, code: 'WRONG_DIMENSIONS' }
    if (app.opaque && png.transparent) return { ok: false, code: 'HAS_TRANSPARENCY' }
    return { ok: true, type }
  }
  if (!type) return { ok: false, code: 'UNSUPPORTED_TYPE' }
  if (type.ext === 'svg') {
    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
    if (unsafeSvg.some((pattern) => pattern.test(text))) return { ok: false, code: 'UNSAFE_SVG' }
  }
  return { ok: true, type }
}
