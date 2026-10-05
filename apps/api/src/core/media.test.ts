import { describe, expect, it } from 'vitest'
import { checkMedia, maxImageBytes, sniffMedia } from './media'

const bytes = (...parts: (number[] | string)[]) => new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)))

// A PNG's signature and IHDR: 640 × 480.
const png = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], [0, 0, 0, 13], 'IHDR', [0, 0, 2, 0x80], [0, 0, 1, 0xe0], [8, 6, 0, 0, 0])
// A JPEG with an APP0 segment, then SOF0: 300 high × 400 wide.
const jpeg = bytes([0xff, 0xd8, 0xff, 0xe0, 0, 16], 'JFIF', [0, 1, 1, 0, 0, 1, 0, 1, 0, 0], [0xff, 0xc0, 0, 17, 8, 0x01, 0x2c, 0x01, 0x90, 3])
// A lossy WebP: 'VP8 ' at 12, the frame's size at 26–29: 800 × 600.
const webp = bytes('RIFF', [0, 0, 0, 0], 'WEBP', 'VP8 ', [0, 0, 0, 0], [0, 0, 0, 0x9d, 0x01, 0x2a], [0x20, 0x03, 0x58, 0x02])
const mp4 = bytes([0, 0, 0, 24], 'ftyp', 'isom', [0, 0, 2, 0])
const avif = bytes([0, 0, 0, 24], 'ftyp', 'avif', [0, 0, 0, 0])

describe('media', () => {
  it('reads the type from the bytes, with an image’s size', () => {
    expect(sniffMedia(png)).toEqual({ kind: 'image', ext: 'png', mime: 'image/png', width: 640, height: 480 })
    expect(sniffMedia(jpeg)).toEqual({ kind: 'image', ext: 'jpg', mime: 'image/jpeg', width: 400, height: 300 })
    expect(sniffMedia(webp)).toEqual({ kind: 'image', ext: 'webp', mime: 'image/webp', width: 800, height: 600 })
    expect(sniffMedia(mp4)).toMatchObject({ kind: 'video', ext: 'mp4' })
    expect(sniffMedia(bytes([0x1a, 0x45, 0xdf, 0xa3, 0]))).toMatchObject({ kind: 'video', ext: 'webm' })
  })

  it('refuses SVG, AVIF, unknown and empty files, and an image over its size', () => {
    expect(sniffMedia(bytes('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull()
    expect(sniffMedia(avif)).toBeNull()
    expect(checkMedia(bytes('hello'))).toEqual({ ok: false, code: 'UNSUPPORTED_TYPE' })
    expect(checkMedia(new Uint8Array())).toEqual({ ok: false, code: 'EMPTY' })
    const big = new Uint8Array(maxImageBytes + 1)
    big.set(png)
    expect(checkMedia(big)).toEqual({ ok: false, code: 'TOO_LARGE' })
  })

  it('answers a size it can’t read as unknown rather than wrong', () => {
    expect(sniffMedia(bytes([0xff, 0xd8, 0xff, 0x00]))).toMatchObject({ width: null, height: null })
  })
})
