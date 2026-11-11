// Small MP4 and WebM files that carry only what a product video's check reads: their type and their length (#1401).

const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0))
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
const box = (type: string, ...payload: number[][]) => {
  const body = payload.flat()
  return [...u32(8 + body.length), ...ascii(type), ...body]
}

/** `bytes` then zeros up to `size`: set at once, since a byte-by-byte copy of 4 MB outran CI's 5 s test limit. */
const padded = (bytes: number[], size: number): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(Math.max(size, bytes.length))
  out.set(bytes)
  return out
}

/** An MP4 whose `mvhd` says `seconds` (version 0, a timescale of 1000); 0 makes it look fragmented, which keeps its length elsewhere. */
export const mp4Of = (seconds: number, size = 0): Uint8Array<ArrayBuffer> => {
  const mvhd = box('mvhd', [0, 0, 0, 0], u32(0), u32(0), u32(1000), u32(seconds * 1000), u32(0x10000))
  const bytes = [...box('ftyp', ascii('isom'), u32(512)), ...box('moov', mvhd)]
  return padded(bytes, size)
}

/** An MP4 with its `moov` after the media, as a file made for streaming isn't; the length must still be found. */
export const mp4MoovLast = (seconds: number): Uint8Array<ArrayBuffer> => {
  const moov = mp4Of(seconds).subarray(box('ftyp', ascii('isom'), u32(512)).length)
  return Uint8Array.from([...box('ftyp', ascii('isom'), u32(512)), ...box('mdat', new Array<number>(64).fill(7)), ...moov])
}

/** A MP4 that names its type and has no `moov` at all. */
export const mp4WithoutLength = (): Uint8Array<ArrayBuffer> => Uint8Array.from(box('ftyp', ascii('isom'), u32(512)))

const float64 = (n: number) => [...new Uint8Array(new Float64Array([n]).buffer)].reverse()

/** A WebM whose Segment › Info says `seconds` (a TimecodeScale of 1 ms, an unknown-size Segment as a live recording has). */
export const webmOf = (seconds: number, size = 0): Uint8Array<ArrayBuffer> => {
  const timecodeScale = [0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40]
  const duration = [0x44, 0x89, 0x88, ...float64(seconds * 1000)]
  const info = [0x15, 0x49, 0xa9, 0x66, 0x80 | (timecodeScale.length + duration.length), ...timecodeScale, ...duration]
  const bytes = [0x1a, 0x45, 0xdf, 0xa3, 0x80, 0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, ...info]
  return padded(bytes, size)
}

/** A WebM that names its type and has no Info. */
export const webmWithoutLength = (): Uint8Array<ArrayBuffer> => Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0x80])
