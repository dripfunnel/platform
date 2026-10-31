import { describe, expect, it } from 'vitest'
import { commonsImages } from './commons'
import { openverseImages } from './openverse'
import { pexelsImages } from './pexels'
import { unsplashImages } from './unsplash'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const serve = (answer: (url: string) => Response | null) => {
  const seen: { url: string; headers: HeadersInit | undefined }[] = []
  const fetchImpl = (async (url: string, init?: RequestInit) => (seen.push({ url, headers: init?.headers }), answer(url) ?? json({}, 404))) as unknown as typeof fetch
  return { fetchImpl, seen }
}

describe('pexels', () => {
  const photo = (host: string) => ({ id: 5, url: 'https://pexels.com/p/5', photographer: 'Ana', alt: 'red linen', src: { medium: `https://${host}/m.jpg`, large2x: `https://${host}/l.jpg` } })
  it('parses a search, sends the key as a header and drops an address off its host', async () => {
    const { fetchImpl, seen } = serve(() => json({ total_results: 2, photos: [photo('images.pexels.com'), photo('evil.example')] }))
    const found = await pexelsImages({ key: 'k'.repeat(12), fetchImpl }).search('linen', 1)
    expect(found).toEqual({ total: 2, photos: [{ id: '5', source: 'pexels', thumb: 'https://images.pexels.com/m.jpg', user: 'Ana', pageUrl: 'https://pexels.com/p/5', tags: 'red linen' }] })
    expect(seen[0]?.headers).toEqual({ Authorization: 'k'.repeat(12) })
  })
  it('returns null on an error or a bad shape, and refuses a download address off its host', async () => {
    expect(await pexelsImages({ key: 'k', fetchImpl: serve(() => json({}, 500)).fetchImpl }).search('x', 1)).toBeNull()
    expect(await pexelsImages({ key: 'k', fetchImpl: serve(() => json({ nope: 1 })).fetchImpl }).search('x', 1)).toBeNull()
    expect(await pexelsImages({ key: 'k', fetchImpl: serve(() => json(photo('evil.example'))).fetchImpl }).download('5')).toBeNull()
    expect(await pexelsImages({ key: 'k', fetchImpl: serve(() => json(photo('images.pexels.com'))).fetchImpl }).download('5')).toBe('https://images.pexels.com/l.jpg')
  })
})

describe('openverse', () => {
  const id = '3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f'
  it('asks for CC0 and public domain only and builds the thumbnail address itself', async () => {
    const { fetchImpl, seen } = serve(() => json({ result_count: 1, results: [{ id, title: 'Red linen', creator: 'Bo', foreign_landing_url: 'https://flickr.com/1', tags: [{ name: 'cloth' }] }] }))
    const found = await openverseImages({ fetchImpl }).search('linen', 2)
    expect(seen[0]?.url).toContain('license=cc0%2Cpdm')
    expect(found?.photos[0]).toEqual({ id, source: 'openverse', thumb: `https://api.openverse.org/v1/images/${id}/thumb/`, user: 'Bo', pageUrl: 'https://flickr.com/1', tags: 'Red linen cloth' })
  })
  it('downloads only a uuid', async () => {
    const images = openverseImages()
    expect(await images.download(id)).toBe(`https://api.openverse.org/v1/images/${id}/thumb/`)
    expect(await images.download('../../etc')).toBeNull()
  })
})

describe('commons', () => {
  const page = (license: string, host = 'upload.wikimedia.org') => ({ pageid: 9, title: 'File:Red linen.jpg', imageinfo: [{ thumburl: `https://${host}/t.jpg`, descriptionurl: 'https://commons.wikimedia.org/wiki/File:Red_linen.jpg', extmetadata: { LicenseShortName: { value: license }, Artist: { value: '<a href="x">Bo</a>' } } }] })
  it('keeps only CC0 and public domain, strips markup, and sends a User-Agent', async () => {
    const { fetchImpl, seen } = serve(() => json({ query: { pages: { a: page('CC0'), b: page('CC BY-SA 4.0'), c: page('Public domain', 'evil.example') } } }))
    const found = await commonsImages({ fetchImpl }).search('linen', 1)
    expect(found?.photos).toHaveLength(1)
    expect(found?.photos[0]).toMatchObject({ id: '9', source: 'commons', user: 'Bo', tags: expect.stringContaining('Red linen') })
    expect(JSON.stringify(seen[0]?.headers)).toContain('User-Agent')
  })
  it('returns results in the search ranking and the search’s total hits', async () => {
    const ranked = { query: { searchinfo: { totalhits: 500 }, pages: { 1: { ...page('CC0'), pageid: 1, index: 2 }, 2: { ...page('CC0'), pageid: 2, index: 1 } } } }
    const found = await commonsImages({ fetchImpl: serve(() => json(ranked)).fetchImpl }).search('linen', 1)
    expect(found?.photos.map((p) => p.id)).toEqual(['2', '1'])
    expect(found?.total).toBe(500)
  })
  it('downloads only a numeric page id whose file is free', async () => {
    const free = commonsImages({ fetchImpl: serve(() => json({ query: { pages: { a: page('CC0') } } })).fetchImpl })
    expect(await free.download('9')).toBe('https://upload.wikimedia.org/t.jpg')
    expect(await free.download('9; drop')).toBeNull()
    expect(await commonsImages({ fetchImpl: serve(() => json({ query: { pages: { a: page('CC BY 4.0') } } })).fetchImpl }).download('9')).toBeNull()
  })
})

describe('unsplash', () => {
  const photo = (host: string, location = 'https://api.unsplash.com/photos/u1/download') => ({ id: 'u1', alt_description: 'red linen', description: null, urls: { small: `https://${host}/s.jpg`, regular: `https://${host}/r.jpg` }, links: { html: 'https://unsplash.com/photos/u1', download_location: location }, user: { name: 'Cy' } })
  it('parses a search and sends the Access Key as Client-ID', async () => {
    const { fetchImpl, seen } = serve(() => json({ total: 1, results: [photo('images.unsplash.com'), photo('evil.example')] }))
    const found = await unsplashImages({ key: 'abc', fetchImpl }).search('linen', 1)
    expect(found?.photos).toEqual([{ id: 'u1', source: 'unsplash', thumb: 'https://images.unsplash.com/s.jpg', user: 'Cy', pageUrl: 'https://unsplash.com/photos/u1', tags: 'red linen ' }])
    expect(seen[0]?.headers).toEqual({ Authorization: 'Client-ID abc' })
  })
  it('pings the download endpoint before returning the address, and refuses a foreign ping address or host', async () => {
    const ok = serve((url) => (url.endsWith('/download') ? json({ url: 'x' }) : json(photo('images.unsplash.com'))))
    expect(await unsplashImages({ key: 'abc', fetchImpl: ok.fetchImpl }).download('u1')).toBe('https://images.unsplash.com/r.jpg')
    expect(ok.seen.map((s) => s.url)).toEqual(['https://api.unsplash.com/photos/u1', 'https://api.unsplash.com/photos/u1/download'])
    const foreign = serve(() => json(photo('images.unsplash.com', 'https://evil.example/ping')))
    expect(await unsplashImages({ key: 'abc', fetchImpl: foreign.fetchImpl }).download('u1')).toBeNull()
    expect(foreign.seen).toHaveLength(1)
    expect(await unsplashImages({ key: 'abc', fetchImpl: serve(() => json(photo('evil.example'))).fetchImpl }).download('u1')).toBeNull()
  })
})

describe('every adapter', () => {
  const broken = [() => json({}, 500), () => json({ query: 'x' }), () => new Response('not json')]
  const adapters = (fetchImpl: typeof fetch) => [pexelsImages({ key: 'k', fetchImpl }), openverseImages({ fetchImpl }), commonsImages({ fetchImpl }), unsplashImages({ key: 'k', fetchImpl })]
  it('gives null for a failed, malformed or unreadable search answer, and for a thrown fetch', async () => {
    for (const answer of broken) for (const images of adapters(serve(answer).fetchImpl)) expect(await images.search('linen', 1)).toBeNull()
    const thrown = (async () => { throw new Error('down') }) as unknown as typeof fetch
    for (const images of adapters(thrown)) expect(await images.search('linen', 1)).toBeNull()
  })
  it('gives null for a failed or malformed download answer', async () => {
    for (const answer of broken) for (const images of adapters(serve(answer).fetchImpl)) expect(await images.download('9')).toBeNull()
  })
  it('refuses an http address on the right host', async () => {
    const pexels = { id: 5, url: 'u', photographer: 'a', src: { medium: 'http://images.pexels.com/m.jpg', large2x: 'http://images.pexels.com/l.jpg' } }
    expect(await pexelsImages({ key: 'k', fetchImpl: serve(() => json(pexels)).fetchImpl }).download('5')).toBeNull()
    const unsplash = { id: 'u1', urls: { small: 'http://images.unsplash.com/s.jpg', regular: 'http://images.unsplash.com/r.jpg' }, links: { html: 'h', download_location: 'https://api.unsplash.com/photos/u1/download' }, user: { name: 'Cy' } }
    expect(await unsplashImages({ key: 'k', fetchImpl: serve(() => json(unsplash)).fetchImpl }).download('u1')).toBeNull()
    const commons = { query: { pages: { a: { pageid: 9, title: 'File:x.jpg', imageinfo: [{ thumburl: 'http://upload.wikimedia.org/t.jpg', descriptionurl: 'd', extmetadata: { LicenseShortName: { value: 'CC0' } } }] } } } }
    expect(await commonsImages({ fetchImpl: serve(() => json(commons)).fetchImpl }).download('9')).toBeNull()
  })
  it('refuses a bad id before asking anyone', async () => {
    const { fetchImpl, seen } = serve(() => json({}))
    expect(await openverseImages({ fetchImpl }).download('not-a-uuid')).toBeNull()
    expect(await commonsImages({ fetchImpl }).download('1 or 1')).toBeNull()
    expect(seen).toHaveLength(0)
  })
})
