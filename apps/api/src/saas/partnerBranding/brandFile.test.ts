import { describe, expect, it } from 'vitest'
import { checkBrandFile, maxBrandFileBytes, readPng } from './brandFile'

const bytes = (text: string) => new TextEncoder().encode(text)
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])
const webp = new Uint8Array([...bytes('RIFF'), 0, 0, 0, 0, ...bytes('WEBPVP8 ')])
const svg = (inner: string) => bytes(`<?xml version="1.0"?><!-- logo --><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${inner}</svg>`)

const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
const chunk = (type: string, data: number[]) => [...u32(data.length), ...bytes(type), ...data, 0, 0, 0, 0]
// A PNG's header and chunks, enough for readPng; the CRCs are not checked.
const pngOf = (width: number, height: number, colourType: number, extra: string[] = []) =>
  new Uint8Array([
    ...png.subarray(0, 8),
    ...chunk('IHDR', [...u32(width), ...u32(height), 8, colourType, 0, 0, 0]),
    ...extra.flatMap((type) => chunk(type, [0])),
    ...chunk('IDAT', [0]),
    ...chunk('IEND', []),
  ])

describe('checkBrandFile', () => {
  it('knows PNG, WebP and SVG by their bytes, and nothing else', () => {
    expect(checkBrandFile(png, 'logoLight')).toEqual({ ok: true, type: { ext: 'png', contentType: 'image/png' } })
    expect(checkBrandFile(webp, 'logoLight')).toEqual({ ok: true, type: { ext: 'webp', contentType: 'image/webp' } })
    expect(checkBrandFile(svg('<defs><linearGradient id="g"/></defs><rect fill="url(#g)" width="10" height="10"/><text>A &amp; B</text>'), 'mark')).toMatchObject({ ok: true, type: { ext: 'svg' } })
    expect(checkBrandFile(bytes('GIF89a....'), 'logoLight')).toEqual({ ok: false, code: 'UNSUPPORTED_TYPE' })
    expect(checkBrandFile(bytes('<html><svg></svg></html>'), 'logoLight')).toEqual({ ok: false, code: 'UNSUPPORTED_TYPE' })
  })

  it('refuses a file over 512 KB', () => {
    const big = new Uint8Array(maxBrandFileBytes + 1)
    big.set(png)
    expect(checkBrandFile(big, 'logoLight')).toEqual({ ok: false, code: 'TOO_LARGE' })
    expect(checkBrandFile(big.subarray(0, maxBrandFileBytes), 'logoLight').ok).toBe(true)
    const icon = new Uint8Array(maxBrandFileBytes + 1)
    icon.set(pngOf(1024, 1024, 2))
    expect(checkBrandFile(icon, 'appIcon')).toEqual({ ok: false, code: 'TOO_LARGE' })
  })

  it('refuses an SVG that could run script or load anything', () => {
    for (const inner of [
      '<script>alert(1)</script>',
      '<rect onload="alert(1)"/>',
      '<a href="javascript:alert(1)"><rect/></a>',
      '<image href="https://evil.example/x.png"/>',
      '<use xlink:href="other.svg#x"/>',
      '<foreignObject><div/></foreignObject>',
      '<style>@import url(https://evil.example/x.css)</style>',
      '<rect style="fill:url(https://evil.example/x)"/>',
      '<x:script xmlns:x="http://www.w3.org/2000/svg">alert(1)</x:script>',
      '<h:foreignObject><h:div/></h:foreignObject>',
      '<a href="&#106;avascript:alert(1)"><rect/></a>',
      '<style>rect { fill: u&#114;l(https://evil.example/x) }</style>',
      '<style>rect { fill: \\75 rl(https://evil.example/x) }</style>',
    ]) {
      expect(checkBrandFile(svg(inner), 'logoLight'), inner).toEqual({ ok: false, code: 'UNSAFE_SVG' })
    }
    expect(checkBrandFile(bytes('<!DOCTYPE svg [<!ENTITY x "y">]><svg>&x;</svg>'), 'logoLight').ok).toBe(false)
  })
})

describe('the mobile app images', () => {
  const accepted = { ok: true, type: { ext: 'png', contentType: 'image/png' } }

  it('takes an opaque 1024 × 1024 PNG icon, a transparent foreground and a splash of any size', () => {
    expect(checkBrandFile(pngOf(1024, 1024, 2), 'appIcon')).toEqual(accepted)
    expect(checkBrandFile(pngOf(1024, 1024, 6), 'appIconForeground')).toEqual(accepted)
    expect(checkBrandFile(pngOf(640, 480, 6), 'splash')).toEqual(accepted)
  })

  it('refuses anything but a PNG, even an SVG or WebP a logo would take', () => {
    for (const kind of ['appIcon', 'appIconForeground', 'splash'] as const) {
      expect(checkBrandFile(svg('<rect/>'), kind)).toEqual({ ok: false, code: 'NOT_PNG' })
      expect(checkBrandFile(webp, kind)).toEqual({ ok: false, code: 'NOT_PNG' })
      expect(checkBrandFile(png, kind), 'a PNG with no header').toEqual({ ok: false, code: 'NOT_PNG' })
    }
  })

  it('refuses an icon that is not 1024 × 1024', () => {
    expect(checkBrandFile(pngOf(512, 512, 2), 'appIcon')).toEqual({ ok: false, code: 'WRONG_DIMENSIONS' })
    expect(checkBrandFile(pngOf(1024, 1023, 6), 'appIconForeground')).toEqual({ ok: false, code: 'WRONG_DIMENSIONS' })
  })

  it('refuses an app icon with an alpha channel or a transparent colour, and only the app icon', () => {
    expect(checkBrandFile(pngOf(1024, 1024, 6), 'appIcon')).toEqual({ ok: false, code: 'HAS_TRANSPARENCY' })
    expect(checkBrandFile(pngOf(1024, 1024, 4), 'appIcon')).toEqual({ ok: false, code: 'HAS_TRANSPARENCY' })
    expect(checkBrandFile(pngOf(1024, 1024, 3, ['PLTE', 'tRNS']), 'appIcon')).toEqual({ ok: false, code: 'HAS_TRANSPARENCY' })
    expect(checkBrandFile(pngOf(1024, 1024, 3, ['PLTE']), 'appIcon')).toEqual(accepted)
  })

  it('reads a PNG’s size and stops at the image data', () => {
    expect(readPng(pngOf(3, 7, 2, ['tEXt']))).toEqual({ width: 3, height: 7, transparent: false })
    expect(readPng(new Uint8Array([...pngOf(1, 1, 2), ...[0, 0, 0, 1, ...bytes('tRNS'), 0, 0, 0, 0, 0]]))).toEqual({ width: 1, height: 1, transparent: false })
  })
})
