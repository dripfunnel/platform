import { describe, expect, it } from 'vitest'
import { browserScreenshots, maxSlices } from './screenshot'

type Asked = { url: string; scrollPage: boolean; viewport: { width: number }; screenshotOptions: { captureBeyondViewport: boolean; clip: { x: number; y: number; width: number; height: number } } }

/** A page `pageHeight` tall: a slice inside it is real (60 KB), one past its end is one flat colour (13 KB). */
const fakePage = (pageHeight: number, failAt: number | null = null) => {
  const asked: Asked[] = []
  const fetchImpl = (async (_: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Asked
    asked.push(body)
    const { y } = body.screenshotOptions.clip
    if (y === failAt) return new Response('busy', { status: 429 })
    return new Response(new Uint8Array(y < pageHeight ? 60_000 : 13_000), { headers: { 'content-type': 'image/jpeg' } })
  }) as typeof fetch
  return { asked, shots: browserScreenshots({ accountId: 'a'.repeat(32), token: 't'.repeat(40), fetchImpl }) }
}

describe('a sample site’s screenshots', () => {
  it('takes the page top down in screen-tall slices, scrolled first so lazy sections are drawn', async () => {
    const { asked, shots } = fakePage(5000)
    const slices = await shots.take(new URL('https://example.com/'), 'desktop')
    expect(slices.map((s) => s.byteLength)).toEqual([60_000, 60_000, 60_000, 60_000])
    expect(asked.map((a) => a.screenshotOptions.clip)).toEqual([0, 1440, 2880, 4320].map((y) => ({ x: 0, y, width: 1440, height: 1440 })))
    expect(asked.every((a) => a.scrollPage && a.screenshotOptions.captureBeyondViewport && a.viewport.width === 1440)).toBe(true)
    expect(asked).toHaveLength(maxSlices)
  })

  it('stops at the page’s end, where a slice is one flat colour, and at the first slice that fails', async () => {
    expect((await fakePage(2000).shots.take(new URL('https://example.com/'), 'desktop')).length).toBe(2)
    expect((await fakePage(9000, 2880).shots.take(new URL('https://example.com/'), 'desktop')).length).toBe(2)
  })

  it('keeps a first slice that is mostly one colour, and gives none when the first can’t be taken', async () => {
    expect((await fakePage(0).shots.take(new URL('https://example.com/'), 'desktop')).length).toBe(1)
    expect(await fakePage(9000, 0).shots.take(new URL('https://example.com/'), 'phone')).toEqual([])
  })
})
