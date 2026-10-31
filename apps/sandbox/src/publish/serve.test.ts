import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sealedWords } from './check'
import { fileFor, shopFixture, type ShopReport } from './serve'

// The check step serves only the build's own files to its browser (LIVE-SHOP §4 step 7); nothing reaches past them.
let root: string
let site: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'serve-test-'))
  site = join(root, 'site')
  mkdirSync(join(site, 'cart'), { recursive: true })
  writeFileSync(join(site, 'index.html'), 'home')
  writeFileSync(join(site, 'cart/index.html'), 'cart')
  writeFileSync(join(root, 'secret.txt'), 'outside the site')
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('fileFor', () => {
  it('finds a page by its address and a file by its path', async () => {
    expect((await fileFor([site], '/'))?.bytes.toString()).toBe('home')
    expect((await fileFor([site], '/cart/'))).toMatchObject({ rel: 'cart/index.html' })
  })

  it('never answers with a file outside its folders, however the path is written', async () => {
    for (const path of ['/../secret.txt', '/cart/../../secret.txt', '/..%2fsecret.txt', '/%2e%2e/secret.txt', '/cart/%2e%2e%2f%2e%2e%2fsecret.txt', '/x\0/index.html', '/%00', '/%E0%A4%A', '/cart']) {
      const found = await fileFor([site], path)
      expect([path, found === null || !found.bytes.toString().includes('outside')]).toEqual([path, true])
    }
    expect(await fileFor([site], '/..%2fsecret.txt')).toBeNull()
    expect(await fileFor([site], '/%E0%A4%A')).toBeNull()
    // A folder is no file: `/cart` isn't its page.
    expect(await fileFor([site], '/cart')).toBeNull()
  })

  it('takes the first folder that has the file', async () => {
    const other = join(root, 'other')
    mkdirSync(other, { recursive: true })
    writeFileSync(join(other, 'index.html'), 'other home')
    expect((await fileFor([other, site], '/'))?.bytes.toString()).toBe('other home')
    expect((await fileFor([other, site], '/cart/'))?.bytes.toString()).toBe('cart')
  })
})

describe('the offline Shop API', () => {
  it('answers a catalogue snapshot’s recorded questions as the build did, and anything else as an outage', () => {
    const snapshot = { store: {}, catalogue: { answers: [{ operation: 'Product', variables: { slug: 'kurta' }, data: { product: { name: 'Kurta' } } }], products: [], collections: [] } } as never
    const answer = shopFixture(snapshot, [])
    expect(answer(JSON.stringify({ query: 'query Product($slug: String!) { product(slug: $slug) { name } }', variables: { slug: 'kurta' } }))).toEqual({ data: { product: { name: 'Kurta' } } })
    expect(answer(JSON.stringify({ query: 'query Product($slug: String!) { product(slug: $slug) { name } }', variables: { slug: 'other' } }))).toMatchObject({ errors: [{ extensions: { code: 'UNAVAILABLE' } }] })
  })
})

describe('a page’s sealed reports', () => {
  it('reach the gate only in core’s words: a theme posting its own subject gets neither its text nor an error in', () => {
    const reports: ShopReport[] = []
    const answer = shopFixture({} as never, reports)
    answer(JSON.stringify({ query: 'mutation Report { reportStorefrontProblem }', variables: { kind: 'SEALED', subject: 'Only 2 left, buy now!', detail: 'too-small' } }))
    answer(JSON.stringify({ query: 'mutation Report { reportStorefrontProblem }', variables: { kind: 'SEALED', subject: 'price', detail: 'covered' } }))
    expect(sealedWords(reports, { path: '/cart/', route: 'cart' })).toEqual(["A required component on the cart page isn't seen.", 'The "price" component on the cart page isn\'t seen: something covers its centre.'])
  })
})
