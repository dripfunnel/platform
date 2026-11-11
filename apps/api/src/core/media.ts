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

// A product's one video (CatEditor; #1401): short enough to stream from the gallery, small enough to hold in memory.
export const maxProductVideoBytes = 4 * 1024 * 1024
export const maxProductVideoSeconds = 30

/** An MP4's length from its `moov` › `mvhd` box; null when it has none or says zero (a fragmented file keeps its length elsewhere). */
const mp4Seconds = (b: Uint8Array): number | null => {
  const boxes = (start: number, end: number, type: string): { payload: number; end: number } | null => {
    let i = start
    while (i + 8 <= end) {
      let length = be32(b, i)
      let header = 8
      if (length === 1) {
        length = be32(b, i + 8) * 2 ** 32 + be32(b, i + 12)
        header = 16
      } else if (length === 0) length = end - i
      if (length < header) return null
      if (String.fromCharCode(at(b, i + 4), at(b, i + 5), at(b, i + 6), at(b, i + 7)) === type) return { payload: i + header, end: Math.min(i + length, end) }
      i += length
    }
    return null
  }
  const moov = boxes(0, b.length, 'moov')
  const mvhd = moov ? boxes(moov.payload, moov.end, 'mvhd') : null
  if (!mvhd) return null
  const version = at(b, mvhd.payload)
  const timescale = be32(b, mvhd.payload + (version === 1 ? 20 : 12))
  const duration = version === 1 ? be32(b, mvhd.payload + 24) * 2 ** 32 + be32(b, mvhd.payload + 28) : be32(b, mvhd.payload + 16)
  return timescale > 0 && duration > 0 ? duration / timescale : null
}

/** An EBML number: its length, and its value with the length marker taken off (or kept, for an element's id). */
const ebml = (b: Uint8Array, i: number, keepMarker: boolean): { value: number; length: number; unknown: boolean } | null => {
  const first = at(b, i)
  let length = 1
  while (length <= 8 && (first & (0x80 >> (length - 1))) === 0) length++
  if (length > 8 || i + length > b.length) return null
  const mask = 0xff >> length
  let value = keepMarker ? first : first & mask
  let unknown = (first & mask) === mask
  for (let k = 1; k < length; k++) {
    value = value * 256 + at(b, i + k)
    unknown = unknown && at(b, i + k) === 0xff
  }
  return { value, length, unknown }
}

const unsigned = (b: Uint8Array, from: number, to: number) => {
  let value = 0
  for (let i = from; i < to; i++) value = value * 256 + at(b, i)
  return value
}

/** A WebM's length from its Segment › Info (Duration × TimecodeScale); null when Info is missing or sits after a Cluster of unknown size. */
const webmSeconds = (b: Uint8Array): number | null => {
  const segment = 0x18538067
  const info = 0x1549a966
  let i = 0
  while (i < b.length) {
    const id = ebml(b, i, true)
    const size = id ? ebml(b, i + id.length, false) : null
    if (!id || !size) return null
    const payload = i + id.length + size.length
    if (id.value === segment) {
      i = payload
      continue
    }
    if (id.value === info) {
      const end = Math.min(payload + size.value, b.length)
      let scale = 1_000_000
      let duration: number | null = null
      for (let j = payload; j < end; ) {
        const child = ebml(b, j, true)
        const length = child ? ebml(b, j + child.length, false) : null
        if (!child || !length || length.unknown) return null
        const from = j + child.length + length.length
        if (child.value === 0x2ad7b1) scale = unsigned(b, from, from + length.value)
        else if (child.value === 0x4489 && (length.value === 4 || length.value === 8)) {
          const view = new DataView(b.buffer, b.byteOffset + from, length.value)
          duration = length.value === 4 ? view.getFloat32(0) : view.getFloat64(0)
        }
        j = from + length.value
      }
      return duration !== null && duration > 0 && scale > 0 ? (duration * scale) / 1e9 : null
    }
    if (size.unknown) return null
    i = payload + size.value
  }
  return null
}

export type ProductVideoCheck = { ok: true; type: Extract<MediaType, { kind: 'video' }>; seconds: number } | { ok: false; code: 'EMPTY' | 'TOO_LARGE' | 'TOO_LONG' | 'UNSUPPORTED_TYPE' }

/** A product video: an MP4 or WebM of at most 4 MB and 30 seconds, its length read from the file itself; one whose length can't be read is refused. */
export const checkProductVideo = (bytes: Uint8Array): ProductVideoCheck => {
  if (bytes.byteLength === 0) return { ok: false, code: 'EMPTY' }
  const type = sniffMedia(bytes)
  if (!type || type.kind !== 'video') return { ok: false, code: 'UNSUPPORTED_TYPE' }
  if (bytes.byteLength > maxProductVideoBytes) return { ok: false, code: 'TOO_LARGE' }
  const seconds = type.ext === 'mp4' ? mp4Seconds(bytes) : webmSeconds(bytes)
  if (seconds === null) return { ok: false, code: 'UNSUPPORTED_TYPE' }
  return seconds > maxProductVideoSeconds ? { ok: false, code: 'TOO_LONG' } : { ok: true, type, seconds }
}

// What a download may be (CatEditor: PDF, ZIP, MP3, MP4 or an image), read from its bytes; never a photo or shown inline.
export type DownloadType = { ext: 'pdf' | 'zip' | 'mp3' | 'mp4' | 'webm' | 'jpg' | 'png' | 'webp'; mime: string }

// Held in memory while it is checked and stored, as a video is; larger files need R2's multipart upload.
export const maxDownloadBytes = 30 * 1024 * 1024

export const sniffDownload = (bytes: Uint8Array): DownloadType | null => {
  if (startsWith(bytes, ascii('%PDF-'))) return { ext: 'pdf', mime: 'application/pdf' }
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return { ext: 'zip', mime: 'application/zip' }
  if (startsWith(bytes, ascii('ID3')) || (at(bytes, 0) === 0xff && (at(bytes, 1) & 0xe0) === 0xe0)) return { ext: 'mp3', mime: 'audio/mpeg' }
  const media = sniffMedia(bytes)
  return media ? { ext: media.ext, mime: media.mime } : null
}

export type DownloadCheck = { ok: true; type: DownloadType } | { ok: false; code: 'EMPTY' | 'TOO_LARGE' | 'UNSUPPORTED_TYPE' }

export const checkDownload = (bytes: Uint8Array): DownloadCheck => {
  if (bytes.byteLength === 0) return { ok: false, code: 'EMPTY' }
  if (bytes.byteLength > maxDownloadBytes) return { ok: false, code: 'TOO_LARGE' }
  const type = sniffDownload(bytes)
  return type ? { ok: true, type } : { ok: false, code: 'UNSUPPORTED_TYPE' }
}
