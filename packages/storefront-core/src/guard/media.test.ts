import { describe, expect, it } from 'vitest'
import { jpeg, png, webp } from '../../test/images'
import { readImage } from './media'

describe('readImage: the type from the bytes and a whole structure', () => {
  it.each([
    ['PNG', png(640, 480), 'png'],
    ['JPEG', jpeg(640, 480), 'jpeg'],
    ['WebP', webp(640, 480), 'webp'],
  ])('reads a %s and its size', (_, bytes, type) => {
    expect(readImage(bytes)).toEqual({ ok: true, type, width: 640, height: 480 })
  })

  it('takes neither text, an SVG nor a GIF for an image', () => {
    const text = (s: string) => new TextEncoder().encode(s)
    expect(readImage(text('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toEqual({ ok: false, reason: 'not-image' })
    expect(readImage(text('GIF89a'))).toEqual({ ok: false, reason: 'not-image' })
    expect(readImage(new Uint8Array())).toEqual({ ok: false, reason: 'not-image' })
  })

  it.each([
    ['a PNG cut short', png().subarray(0, 40)],
    ['a PNG with a damaged chunk', png().map((b, i) => (i === 40 ? b ^ 0xff : b))],
    ['a PNG with bytes after IEND', new Uint8Array([...png(), 0])],
    ['a JPEG cut before EOI', jpeg().subarray(0, -2)],
    ['a JPEG with no frame header', new Uint8Array([0xff, 0xd8, 0xff, 0xd9])],
    ['a WebP whose RIFF size is wrong', new Uint8Array([...webp(), 0, 0])],
  ])('calls %s broken', (_, bytes) => {
    expect(readImage(bytes)).toEqual({ ok: false, reason: 'broken' })
  })

  it('refuses a side of 0 or over 10,000 pixels', () => {
    expect(readImage(png(0, 10))).toEqual({ ok: false, reason: 'dimensions' })
    expect(readImage(jpeg(10_001, 10))).toEqual({ ok: false, reason: 'dimensions' })
    expect(readImage(png(10_000, 1))).toMatchObject({ ok: true })
  })
})
