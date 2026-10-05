// A catalogue file's type read from its bytes, whatever the request says (CATALOG F; DATA-MODEL §7.3
// `asset`), with an image's size from its header. Photos are raster only: an SVG can carry script.

export type MediaType =
  | { kind: 'image'; ext: 'jpg' | 'png' | 'webp'; mime: string; width: number | null; height: number | null }
  | { kind: 'video'; ext: 'mp4' | 'webm'; mime: string; width: null; height: null }

export const maxImageBytes = 20 * 1024 * 1024
// Held in the Worker's memory while it is checked and stored; longer films are linked instead.
export const maxVideoBytes = 30 * 1024 * 1024

const at = (bytes: Uint8Array, i: number): number => bytes[i] ?? 0
const startsWith = (bytes: Uint8Array, prefix: readonly number[], offset = 0) => prefix.every((b, i) => bytes[offset + i] === b)
const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0))
const be16 = (b: Uint8Array, i: number) => (at(b, i) << 8) | at(b, i + 1)
const be32 = (b: Uint8Array, i: number) => ((at(b, i) << 24) >>> 0) + (at(b, i + 1) << 16) + (at(b, i + 2) << 8) + at(b, i + 3)
const le24 = (b: Uint8Array, i: number) => at(b, i) | (at(b, i + 1) << 8) | (at(b, i + 2) << 16)

const size = (width: number, height: number) => (width > 0 && height > 0 ? { width, height } : { width: null, height: null })

/** The first SOFn frame's size: markers C0–CF but C4 (tables), C8 (reserved) and CC (arithmetic). */
const jpegSize = (b: Uint8Array) => {
  let i = 2
  while (i + 9 < b.length) {
    if (at(b, i) !== 0xff) return size(0, 0)
    const marker = at(b, i + 1)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return size(be16(b, i + 7), be16(b, i + 5))
    i += 2 + be16(b, i + 2)
  }
  return size(0, 0)
}

const webpSize = (b: Uint8Array) => {
  if (startsWith(b, ascii('VP8 '), 12)) return size((at(b, 26) | (at(b, 27) << 8)) & 0x3fff, (at(b, 28) | (at(b, 29) << 8)) & 0x3fff)
  if (startsWith(b, ascii('VP8L'), 12)) return size(1 + (((at(b, 22) & 0x3f) << 8) | at(b, 21)), 1 + (((at(b, 24) & 0x0f) << 10) | (at(b, 23) << 2) | ((at(b, 22) & 0xc0) >> 6)))
  if (startsWith(b, ascii('VP8X'), 12)) return size(1 + le24(b, 24), 1 + le24(b, 27))
  return size(0, 0)
}

// ISO media brands that are video; avif and heic share the box and are images this release refuses.
const videoBrands = new Set(['isom', 'iso2', 'mp41', 'mp42', 'avc1', 'dash', 'M4V '])

export const sniffMedia = (bytes: Uint8Array): MediaType | null => {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { kind: 'image', ext: 'jpg', mime: 'image/jpeg', ...jpegSize(bytes) }
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { kind: 'image', ext: 'png', mime: 'image/png', ...size(be32(bytes, 16), be32(bytes, 20)) }
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) return { kind: 'image', ext: 'webp', mime: 'image/webp', ...webpSize(bytes) }
  if (startsWith(bytes, ascii('ftyp'), 4) && videoBrands.has(String.fromCharCode(...bytes.subarray(8, 12)))) return { kind: 'video', ext: 'mp4', mime: 'video/mp4', width: null, height: null }
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return { kind: 'video', ext: 'webm', mime: 'video/webm', width: null, height: null }
  return null
}

export type MediaCheck = { ok: true; type: MediaType } | { ok: false; code: 'EMPTY' | 'TOO_LARGE' | 'UNSUPPORTED_TYPE' }

export const checkMedia = (bytes: Uint8Array): MediaCheck => {
  if (bytes.byteLength === 0) return { ok: false, code: 'EMPTY' }
  const type = sniffMedia(bytes)
  if (!type) return { ok: false, code: 'UNSUPPORTED_TYPE' }
  if (bytes.byteLength > (type.kind === 'image' ? maxImageBytes : maxVideoBytes)) return { ok: false, code: 'TOO_LARGE' }
  return { ok: true, type }
}
