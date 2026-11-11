import { describe, expect, it } from 'vitest'
import { mp4MoovLast, mp4Of, mp4WithoutLength, webmOf, webmWithoutLength } from '../../tests/support/video'
import { checkDownload, checkMedia, checkProductVideo, maxDownloadBytes, maxImageBytes, maxProductVideoBytes, sniffDownload, sniffMedia } from './media'

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

  it('reads a download’s type from its bytes, and refuses a script, an empty file and one over its size', () => {
    expect(sniffDownload(bytes('%PDF-1.7'))).toEqual({ ext: 'pdf', mime: 'application/pdf' })
    expect(sniffDownload(bytes([0x50, 0x4b, 0x03, 0x04]))).toEqual({ ext: 'zip', mime: 'application/zip' })
    expect(sniffDownload(bytes('ID3', [4, 0]))).toEqual({ ext: 'mp3', mime: 'audio/mpeg' })
    expect(sniffDownload(png)).toEqual({ ext: 'png', mime: 'image/png' })
    expect(sniffDownload(mp4)).toEqual({ ext: 'mp4', mime: 'video/mp4' })
    expect(checkDownload(bytes('#!/bin/sh'))).toEqual({ ok: false, code: 'UNSUPPORTED_TYPE' })
    expect(checkDownload(new Uint8Array())).toEqual({ ok: false, code: 'EMPTY' })
    expect(checkDownload(new Uint8Array(maxDownloadBytes + 1))).toEqual({ ok: false, code: 'TOO_LARGE' })
  })
})

// A product's one video (#1401): an MP4 or WebM of at most 4 MB and 30 seconds, its length read from the file.
describe('a product video', () => {
  it('takes an MP4 or a WebM of up to 30 seconds, reading the length from the file', () => {
    expect(checkProductVideo(mp4Of(20))).toMatchObject({ ok: true, type: { ext: 'mp4' }, seconds: 20 })
    expect(checkProductVideo(mp4Of(30))).toMatchObject({ ok: true, seconds: 30 })
    expect(checkProductVideo(webmOf(20))).toMatchObject({ ok: true, type: { ext: 'webm' }, seconds: 20 })
    expect(checkProductVideo(webmOf(30))).toMatchObject({ ok: true, seconds: 30 })
  })

  it('finds an MP4’s length when its moov box comes after the media', () => {
    expect(checkProductVideo(mp4MoovLast(12))).toMatchObject({ ok: true, seconds: 12 })
  })

  it('refuses a video longer than 30 seconds', () => {
    expect(checkProductVideo(mp4Of(31))).toEqual({ ok: false, code: 'TOO_LONG' })
    expect(checkProductVideo(webmOf(31))).toEqual({ ok: false, code: 'TOO_LONG' })
  })

  it('refuses a video over 4 MB, before reading its length', () => {
    expect(checkProductVideo(mp4Of(10, maxProductVideoBytes + 1))).toEqual({ ok: false, code: 'TOO_LARGE' })
    expect(checkProductVideo(webmOf(10, maxProductVideoBytes + 1))).toEqual({ ok: false, code: 'TOO_LARGE' })
    expect(checkProductVideo(mp4Of(10, maxProductVideoBytes))).toMatchObject({ ok: true })
  })

  it('refuses a video whose length can’t be read, one that says zero, and a file that isn’t a video', () => {
    expect(checkProductVideo(mp4WithoutLength())).toEqual({ ok: false, code: 'UNSUPPORTED_TYPE' })
    expect(checkProductVideo(mp4Of(0))).toEqual({ ok: false, code: 'UNSUPPORTED_TYPE' })
    expect(checkProductVideo(webmWithoutLength())).toEqual({ ok: false, code: 'UNSUPPORTED_TYPE' })
    expect(checkProductVideo(png)).toEqual({ ok: false, code: 'UNSUPPORTED_TYPE' })
    expect(checkProductVideo(new Uint8Array())).toEqual({ ok: false, code: 'EMPTY' })
  })
})
