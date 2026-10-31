import { describe, expect, it } from 'vitest'
import { stockImages } from './combine'
import type { StockImages } from './pixabay'

const photo = (id: string, tags: string) => ({ id, source: 'x', thumb: 't', user: 'u', pageUrl: 'p', tags })
const source = (photos: ReturnType<typeof photo>[] | null, file: string | null = null): StockImages => ({ search: async () => (photos ? { total: photos.length, photos } : null), download: async () => file })

describe('stockImages', () => {
  it('keeps only results holding every word, interleaves sources and prefixes ids', async () => {
    const all = stockImages({ a: source([photo('1', 'red linen'), photo('2', 'red wool')]), b: source([photo('9', 'Linen, RED cloth')]) })
    const found = await all?.search('red linen', 1)
    expect(found?.photos.map((p) => p.id)).toEqual(['a:1', 'b:9'])
    expect(found?.photos.map((p) => p.source)).toEqual(['a', 'b'])
  })
  it('survives a failing source, fails when all fail, and is off with none', async () => {
    expect((await stockImages({ a: source(null), b: source([photo('1', 'red')]) })?.search('red', 1))?.photos).toHaveLength(1)
    expect(await stockImages({ a: source(null) })?.search('red', 1)).toBeNull()
    expect(stockImages({})).toBeNull()
  })
  it('re-asks only the named source', async () => {
    const all = stockImages({ a: source([], 'https://a/1.jpg'), b: source([], 'https://b/1.jpg') })
    expect(await all?.download('b:77')).toBe('https://b/1.jpg')
    expect(await all?.download('nope:1')).toBeNull()
    expect(await all?.download('77')).toBeNull()
    for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) expect(await all?.download(`${name}:1`)).toBeNull()
  })
})
