import { describe, expect, it } from 'vitest'
import { checkBrandFile, maxBrandFileBytes } from './brandFile'

const bytes = (text: string) => new TextEncoder().encode(text)
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])
const webp = new Uint8Array([...bytes('RIFF'), 0, 0, 0, 0, ...bytes('WEBPVP8 ')])
const svg = (inner: string) => bytes(`<?xml version="1.0"?><!-- logo --><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${inner}</svg>`)

describe('checkBrandFile', () => {
  it('knows PNG, WebP and SVG by their bytes, and nothing else', () => {
    expect(checkBrandFile(png)).toEqual({ ok: true, type: { ext: 'png', contentType: 'image/png' } })
    expect(checkBrandFile(webp)).toEqual({ ok: true, type: { ext: 'webp', contentType: 'image/webp' } })
    expect(checkBrandFile(svg('<defs><linearGradient id="g"/></defs><rect fill="url(#g)" width="10" height="10"/><text>A &amp; B</text>'))).toMatchObject({ ok: true, type: { ext: 'svg' } })
    expect(checkBrandFile(bytes('GIF89a....'))).toEqual({ ok: false, code: 'UNSUPPORTED_TYPE' })
    expect(checkBrandFile(bytes('<html><svg></svg></html>'))).toEqual({ ok: false, code: 'UNSUPPORTED_TYPE' })
  })

  it('refuses a file over 512 KB', () => {
    const big = new Uint8Array(maxBrandFileBytes + 1)
    big.set(png)
    expect(checkBrandFile(big)).toEqual({ ok: false, code: 'TOO_LARGE' })
    expect(checkBrandFile(big.subarray(0, maxBrandFileBytes)).ok).toBe(true)
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
      expect(checkBrandFile(svg(inner)), inner).toEqual({ ok: false, code: 'UNSAFE_SVG' })
    }
    expect(checkBrandFile(bytes('<!DOCTYPE svg [<!ENTITY x "y">]><svg>&x;</svg>')).ok).toBe(false)
  })
})
