export type ImageType = 'png' | 'jpeg' | 'webp'

/** What a theme image's bytes are, or why they are no image of ours (ARCHITECTURE §3.4 "Files"). */
export type ImageRead = { ok: true; type: ImageType; width: number; height: number } | { ok: false; reason: 'not-image' | 'broken' | 'dimensions' }

export const maxImageSide = 10_000

const startsWith = (bytes: Uint8Array, prefix: readonly number[], at = 0) => prefix.every((b, i) => bytes[at + i] === b)
const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0))
const u16be = (b: Uint8Array, i: number) => ((b[i] ?? 0) << 8) | (b[i + 1] ?? 0)
const u16le = (b: Uint8Array, i: number) => (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8)
const u24le = (b: Uint8Array, i: number) => u16le(b, i) | ((b[i + 2] ?? 0) << 16)
const u32be = (b: Uint8Array, i: number) => (u16be(b, i) * 0x10000 + u16be(b, i + 2)) >>> 0
const u32le = (b: Uint8Array, i: number) => (u16le(b, i) + u16le(b, i + 2) * 0x10000) >>> 0

const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (bytes: Uint8Array, from: number, to: number) => {
  let c = 0xffffffff
  for (let i = from; i < to; i++) c = (crcTable[(c ^ (bytes[i] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** Every chunk whole with its CRC, IHDR first and IEND last at the file's end. */
const readPng = (b: Uint8Array): ImageRead => {
  let at = 8
  let size: { width: number; height: number } | null = null
  while (at + 12 <= b.length) {
    const length = u32be(b, at)
    const end = at + 12 + length
    if (end > b.length || u32be(b, end - 4) !== crc32(b, at + 4, end - 4)) return { ok: false, reason: 'broken' }
    const type = String.fromCharCode(...b.subarray(at + 4, at + 8))
    if (size === null) {
      if (type !== 'IHDR' || length !== 13) return { ok: false, reason: 'broken' }
      size = { width: u32be(b, at + 8), height: u32be(b, at + 12) }
    }
    if (type === 'IEND') return end === b.length ? { ok: true, type: 'png', ...size } : { ok: false, reason: 'broken' }
    at = end
  }
  return { ok: false, reason: 'broken' }
}

const isFrame = (marker: number) => marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc

/** Segments from SOI, a frame header giving the size, and the scan data running to EOI. */
const readJpeg = (b: Uint8Array): ImageRead => {
  let at = 2
  let size: { width: number; height: number } | null = null
  while (at + 2 <= b.length) {
    if (b[at] !== 0xff) return { ok: false, reason: 'broken' }
    const marker = b[at + 1] ?? 0
    if (marker === 0xff) {
      at++
      continue
    }
    if (marker === 0xd9) return size ? { ok: true, type: 'jpeg', ...size } : { ok: false, reason: 'broken' }
    const length = u16be(b, at + 2)
    if (length < 2 || at + 2 + length > b.length) return { ok: false, reason: 'broken' }
    if (isFrame(marker)) size = { height: u16be(b, at + 5), width: u16be(b, at + 7) }
    at += 2 + length
    if (marker !== 0xda) continue
    // Scan data runs to the next marker that isn't a stuffed 0xFF00 or a restart marker.
    while (at + 1 < b.length && !(b[at] === 0xff && b[at + 1] !== 0x00 && !((b[at + 1] ?? 0) >= 0xd0 && (b[at + 1] ?? 0) <= 0xd7))) at++
  }
  return { ok: false, reason: 'broken' }
}

/** A RIFF container exactly the file's length, its chunks whole, and a VP8, VP8L or VP8X header giving the size. */
const readWebp = (b: Uint8Array): ImageRead => {
  if (u32le(b, 4) + 8 !== b.length) return { ok: false, reason: 'broken' }
  let at = 12
  let size: { width: number; height: number } | null = null
  while (at + 8 <= b.length) {
    const type = String.fromCharCode(...b.subarray(at, at + 4))
    const length = u32le(b, at + 4)
    const data = at + 8
    if (data + length > b.length) return { ok: false, reason: 'broken' }
    if (size === null) {
      if (type === 'VP8X' && length >= 10) size = { width: u24le(b, data + 4) + 1, height: u24le(b, data + 7) + 1 }
      else if (type === 'VP8 ' && length >= 10 && startsWith(b, [0x9d, 0x01, 0x2a], data + 3)) size = { width: u16le(b, data + 6) & 0x3fff, height: u16le(b, data + 8) & 0x3fff }
      else if (type === 'VP8L' && length >= 5 && b[data] === 0x2f) {
        const bits = u32le(b, data + 1)
        size = { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
      } else return { ok: false, reason: 'broken' }
    }
    at = data + length + (length % 2)
  }
  return at === b.length && size ? { ok: true, type: 'webp', ...size } : { ok: false, reason: 'broken' }
}

/** The type from the bytes, never the name, and the structure whole: a structural read, not a pixel decode (#1405). */
export const readImage = (bytes: Uint8Array): ImageRead => {
  const read = startsWith(bytes, pngSignature)
    ? readPng(bytes)
    : startsWith(bytes, [0xff, 0xd8, 0xff])
      ? readJpeg(bytes)
      : startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)
        ? readWebp(bytes)
        : ({ ok: false, reason: 'not-image' } as const)
  if (!read.ok) return read
  return read.width < 1 || read.height < 1 || read.width > maxImageSide || read.height > maxImageSide ? { ok: false, reason: 'dimensions' } : read
}

/** A base64 file's bytes, or null when it isn't base64. */
export const fromBase64 = (text: string): Uint8Array | null => {
  try {
    return Uint8Array.from(atob(text), (c) => c.charCodeAt(0))
  } catch {
    return null
  }
}
