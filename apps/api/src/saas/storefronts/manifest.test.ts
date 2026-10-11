import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { digestOf, isSitePath, manifestSchema } from './manifest'

// INF 2b (#517): the manifest and its digest (storefront LIVE-SHOP.md §4 steps 7–8).

const sha = (text: string) => createHash('sha256').update(text).digest('hex')
const file = (path: string, text = path) => ({ path, sha256: sha(text), size: text.length })

describe('digestOf', () => {
  it('is sha256sum’s listing of the files, sorted by path, hashed', async () => {
    const files = [file('index.html'), file('assets/app.js'), file('_next/data.json')]
    const listing = [files[2], files[1], files[0]].map((f) => `${f?.sha256}  ${f?.path}\n`).join('')
    expect(await digestOf(files)).toBe(sha(listing))
  })

  it('doesn’t depend on the order the files are listed in, and changes with any file', async () => {
    const files = [file('a.html'), file('b.html')]
    expect(await digestOf(files)).toBe(await digestOf([...files].reverse()))
    expect(await digestOf(files)).not.toBe(await digestOf([file('a.html'), file('b.html', 'other bytes')]))
    expect(await digestOf(files)).not.toBe(await digestOf([file('a.html')]))
  })
})

describe('manifestSchema', () => {
  it('takes plain relative paths and refuses anything that could leave the build’s folder', () => {
    expect(['index.html', 'assets/app.3f2a.js', '_next/static/x.css', 'p/blue-shirt/index.html'].every(isSitePath)).toBe(true)
    expect(['../x', 'a/../b', '/abs', '', 'a//b', '.hidden', 'a/.env', 'a\\b', '_manifest.json', 'x'.repeat(513)].some(isSitePath)).toBe(false)
  })

  it('refuses a path twice, headers on anything but HTML, a header other than the CSP, and unknown fields', () => {
    const ok = { files: [{ ...file('index.html'), headers: { 'content-security-policy': "default-src 'self'" } }] }
    expect(manifestSchema.safeParse(ok).success).toBe(true)
    expect(manifestSchema.safeParse({ files: [file('a.html'), file('a.html')] }).success).toBe(false)
    expect(manifestSchema.safeParse({ files: [{ ...file('app.js'), headers: { 'content-security-policy': 'x' } }] }).success).toBe(false)
    expect(manifestSchema.safeParse({ files: [{ ...file('a.html'), headers: { 'set-cookie': 'x' } }] }).success).toBe(false)
    expect(manifestSchema.safeParse({ files: [{ ...file('a.html'), unchanged: true }] }).success).toBe(false)
    expect(manifestSchema.safeParse({ files: [] }).success).toBe(false)
  })
})
