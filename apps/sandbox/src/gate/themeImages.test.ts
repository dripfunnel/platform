import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bundle } from './bundle'
import { imageThemeFiles, readImages } from './media'

// A theme's own images (#1405): copied into assets/ by their content, named in CSS beside the stylesheet, and handed to
// ThemeImage by file name through the entry.

const baseline = fileURLToPath(new URL('../../../../packages/storefront-core/src/guard/fixtures/baseline/', import.meta.url))
// The bundle copies bytes and never reads them as images (the validator did), so only names and content matter here.
const webp = Buffer.from([...Buffer.from('RIFF'), 18, 0, 0, 0, ...Buffer.from('WEBPVP8L'), 5, 0, 0, 0, 0x2f, 0x03, 0x80, 0x00, 0x00, 0])
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9, 0x00, 0x7f, 0x80, 0xff])
let repo = ''

const filesIn = (dir: string) => readdirSync(join(dir, 'assets'))
const textOf = (dir: string, suffix: string) =>
  filesIn(dir)
    .filter((f) => f.endsWith(suffix))
    .map((f) => readFileSync(join(dir, 'assets', f), 'utf8'))
    .join('')

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'df-images-'))
  cpSync(baseline, repo, { recursive: true, filter: (from) => !from.includes('node_modules') })
  mkdirSync(join(repo, 'src/theme/media'), { recursive: true })
  writeFileSync(join(repo, 'src/theme/media/haldi-home.webp'), webp)
  writeFileSync(join(repo, 'src/theme/media/photo.jpeg'), jpeg)
  const home = join(repo, 'src/theme/styles/page.module.css')
  writeFileSync(home, `${readFileSync(home, 'utf8')}\n.banner { background-image: url(media/haldi-home.webp); }\n`)
})
afterAll(() => rmSync(repo, { recursive: true, force: true }))

describe('a theme’s own images in the bundle (#1405)', () => {
  it('copies each image byte for byte under a name from its content, .jpeg as .jpg, and lists it with the bundle', async () => {
    const out = mkdtempSync(join(tmpdir(), 'df-images-out-'))
    try {
      const built = await bundle(repo, out)
      expect(built.ok, JSON.stringify(built.ok ? null : built.problems)).toBe(true)
      const images = await readImages(repo)
      expect(images.map((i) => i.file)).toEqual([expect.stringMatching(/^media-[0-9a-f]{16}\.webp$/), expect.stringMatching(/^media-[0-9a-f]{16}\.jpg$/)])
      for (const image of images) expect(readFileSync(join(out, 'assets', image.file))).toEqual(image.bytes)
      expect(built.ok && built.bundle.files.map((f) => f.path)).toEqual(expect.arrayContaining(images.map((i) => `assets/${i.file}`)))
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  })

  it('names the copy beside the stylesheet in CSS, and beside the entry for ThemeImage in the studio and a preview', async () => {
    const out = mkdtempSync(join(tmpdir(), 'df-images-out-'))
    try {
      expect((await bundle(repo, out)).ok).toBe(true)
      const [hero] = await readImages(repo)
      expect(textOf(out, '.css')).toMatch(new RegExp(`url\\("?\\./${hero?.file}"?\\)`))
      expect(textOf(out, '.js')).toContain(`"haldi-home.webp":new URL("./${hero?.file}",import.meta.url).href`)
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  })

  it('names each image whole in a live build, as its pages do', async () => {
    const out = mkdtempSync(join(tmpdir(), 'df-images-live-'))
    try {
      expect((await bundle(repo, out, 'https://shop.example.com', 'https://sf-assets.example.com/stores/s1/builds/b1/assets/assets/')).ok).toBe(true)
      const [hero] = await readImages(repo)
      expect(textOf(out, '.js')).toContain(`"haldi-home.webp":"https://sf-assets.example.com/stores/s1/builds/b1/assets/assets/${hero?.file}"`)
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  })

  it('stops the bundle at a CSS url(media/…) with no image', async () => {
    const broken = mkdtempSync(join(tmpdir(), 'df-images-broken-'))
    const out = mkdtempSync(join(tmpdir(), 'df-images-out-'))
    try {
      cpSync(repo, broken, { recursive: true })
      const home = join(broken, 'src/theme/styles/page.module.css')
      writeFileSync(home, `${readFileSync(home, 'utf8')}\n.gone { background-image: url(media/missing.webp); }\n`)
      const built = await bundle(broken, out)
      expect(built.ok).toBe(false)
      expect(built.ok ? [] : built.problems.map((p) => p.message)).toContainEqual(expect.stringContaining('media/missing.webp'))
    } finally {
      rmSync(broken, { recursive: true, force: true })
      rmSync(out, { recursive: true, force: true })
    }
  })

  it('hands the validator every file under media/ as base64, whatever its name', async () => {
    writeFileSync(join(repo, 'src/theme/media/logo.svg'), '<svg/>')
    try {
      const files = await imageThemeFiles(repo)
      expect(files.map((f) => f.path).sort()).toEqual(['src/theme/media/haldi-home.webp', 'src/theme/media/logo.svg', 'src/theme/media/photo.jpeg'])
      expect(files.find((f) => f.path.endsWith('haldi-home.webp'))).toEqual({ path: 'src/theme/media/haldi-home.webp', content: webp.toString('base64'), encoding: 'base64' })
    } finally {
      rmSync(join(repo, 'src/theme/media/logo.svg'))
    }
  })
})
