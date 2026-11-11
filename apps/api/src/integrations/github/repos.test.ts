import { describe, expect, it } from 'vitest'
import type { GitHubCall } from './app'
import { storeRepos } from './repos'

// `themeMedia` (#1415): only `src/theme/media/` images by core's name rule, within ARCHITECTURE §3.4's caps.

const mb = 1024 * 1024
const commit = 'c'.repeat(40)
const root = 'd'.repeat(40)

interface Entry {
  path: string
  bytes: number
  /** What GitHub's tree says, when it differs from the blob's real size. */
  listed?: number
  type?: 'blob' | 'tree'
}

/** GitHub answering one commit's tree and its blobs; `fetched` names each blob read. */
const github = (entries: readonly Entry[]) => {
  const fetched: string[] = []
  const shaOf = (i: number) => i.toString(16).padStart(40, '0')
  const base64 = new Map<number, string>()
  const call: GitHubCall = async (_, path) => {
    if (path.endsWith(`/git/commits/${commit}`)) return { status: 200, body: { sha: commit, tree: { sha: root } } }
    if (path.endsWith(`/git/trees/${root}?recursive=1`))
      return { status: 200, body: { sha: root, tree: entries.map((e, i) => ({ path: e.path, type: e.type ?? 'blob', sha: shaOf(i), size: e.listed ?? e.bytes })) } }
    const i = entries.findIndex((_, n) => path.endsWith(`/git/blobs/${shaOf(n)}`))
    const entry = entries[i]
    if (!entry) throw new Error(`unexpected ${path}`)
    fetched.push(entry.path)
    // Blobs of one size share their base64, so the 20 MB case stays cheap.
    if (!base64.has(entry.bytes)) base64.set(entry.bytes, Buffer.alloc(entry.bytes, 1).toString('base64'))
    return { status: 200, body: { content: base64.get(entry.bytes) } }
  }
  return { read: () => storeRepos(call, 'dripfunnel').themeMedia('sf-abcdefghij', commit), fetched }
}

const image = (name: string, bytes = 10): Entry => ({ path: `src/theme/media/${name}`, bytes })

describe('themeMedia', () => {
  it('takes only images directly in src/theme/media/ named as core allows, without reading the others', async () => {
    const long = 'a'.repeat(65)
    const gh = github([
      image('hero.png'),
      image('photo.jpg'),
      image('wide.jpeg'),
      image('logo_mark-2.webp'),
      image('sub/nested.png'),
      image('anim.gif'),
      image('shout.PNG'),
      image('-dash.png'),
      image(`${long}.png`),
      image(`${'b'.repeat(64)}.png`),
      { path: 'src/theme/hero.png', bytes: 10 },
      { path: 'media/hero.png', bytes: 10 },
      { path: 'src/theme/media/folder.png', bytes: 0, type: 'tree' },
    ])
    expect((await gh.read()).map((i) => i.name)).toEqual(['hero', 'photo', 'wide', 'logo_mark-2', 'b'.repeat(64)])
    expect(gh.fetched).toEqual(['hero.png', 'photo.jpg', 'wide.jpeg', 'logo_mark-2.webp', `${'b'.repeat(64)}.png`].map((n) => `src/theme/media/${n}`))
  })

  it('keeps an image of exactly 2 MB and skips a larger one, unread when the tree says so and dropped when its bytes do', async () => {
    const gh = github([image('fits.png', 2 * mb), image('listed-big.png', 2 * mb + 1), { ...image('really-big.png', 2 * mb + 1), listed: 10 }])
    const images = await gh.read()
    expect(images.map((i) => [i.name, i.bytes.byteLength])).toEqual([['fits', 2 * mb]])
    expect(gh.fetched).toEqual(['src/theme/media/fits.png', 'src/theme/media/really-big.png'])
  })

  it('stops at 100 images, reading no more', async () => {
    const gh = github(Array.from({ length: 101 }, (_, i) => image(`i${i}.png`, 1)))
    expect(await gh.read()).toHaveLength(100)
    expect(gh.fetched).not.toContain('src/theme/media/i100.png')
  })

  // Decoding 20 MB of real base64 takes seconds on a CI runner, past vitest's 5 s default.
  it('takes images up to 20 MB in all and skips any that would pass it', { timeout: 30_000 }, async () => {
    const gh = github([...Array.from({ length: 10 }, (_, i) => image(`big${i}.png`, 2 * mb)), image('one-more.png', 1)])
    const images = await gh.read()
    expect(images.map((i) => i.name)).toEqual(Array.from({ length: 10 }, (_, i) => `big${i}`))
    expect(images.reduce((sum, i) => sum + i.bytes.byteLength, 0)).toBe(20 * mb)
  })
})
