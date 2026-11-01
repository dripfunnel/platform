// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { Provided } from '../../../test/shop'
import type { RenderMode } from '../store/context'
import { frameAddress, Image, Video } from './media'
import { asMain, photoSchema, videoSchema } from './photo'

const photo = photoSchema.parse({ alt: 'Front', image: { url: 'https://shop.example/shop-api/assets/a' } })
const video = videoSchema.parse({ file: { url: 'https://shop.example/shop-api/assets/v' } })

const html = (mode: RenderMode, node: React.ReactNode) => renderToStaticMarkup(<Provided mode={mode}>{node}</Provided>)

describe('frameAddress', () => {
  const base = '/__studio/abcdefghijklmnopqrstuv/'
  it('moves a shop file under the frame’s session path, whatever origin it was written with, and leaves other addresses alone', () => {
    expect(frameAddress('https://test-preview.my-store.localhost/shop-api/assets/a1', base)).toBe(`${base}shop-api/assets/a1`)
    expect(frameAddress('/shop-api/assets/a1', base)).toBe(`${base}shop-api/assets/a1`)
    expect(frameAddress('https://cdn.example/x.png', base)).toBe('https://cdn.example/x.png')
    expect(frameAddress('https://shop.example/shop-api/assets/a1', null)).toBe('https://shop.example/shop-api/assets/a1')
  })
})

describe('Image in the studio frame', () => {
  it('asks for the shop’s files at the host root outside the frame’s session path, since the frame carries no cookie', () => {
    if (!photo) throw new Error('no photo')
    expect(html('studio', <Image image={photo} alt="Front" ratio={1} />)).toContain('src="https://shop.example/shop-api/assets/a"')
  })
})

describe('Image', () => {
  it('is resized in modern formats on the live site, with its width and height always set', () => {
    if (!photo) throw new Error('no photo')
    const live = html('live', <Image image={photo} alt="Front" ratio={0.8} sizes="50vw" />)
    expect(live).toContain('src="/cdn-cgi/image/width=960,quality=82,format=auto/https://shop.example/shop-api/assets/a"')
    expect(live).toContain('320w')
    expect(live).toContain('width="1200" height="1500"')
    expect(live).toContain('loading="lazy"')
    expect(html('preview', <Image image={photo} alt="Front" ratio={1} />)).toContain('src="https://shop.example/shop-api/assets/a"')
  })

  it("loads eagerly only the picture core chose as the page's main one", () => {
    if (!photo) throw new Error('no photo')
    const main = html('live', <Image image={asMain(photo)} alt="Front" ratio={1} />)
    expect(main).toContain('loading="eager"')
    expect(main).toMatch(/fetchpriority="high"/i)
  })

  it('takes no picture without an address', () => {
    expect(photoSchema.parse({ alt: 'x', image: null })).toBeNull()
  })
})

describe('Video', () => {
  it('needs a poster, never preloads, and always offers its controls, playing on its own or not', () => {
    if (!photo || !video) throw new Error('no media')
    const out = html('preview', <Video video={video} poster={photo} label="How it drapes" ratio={1.5} />)
    expect(out).toContain('preload="none"')
    expect(out).toContain('poster="https://shop.example/shop-api/assets/a"')
    expect(out).toContain('controls')
    expect(out).toContain('aria-label="How it drapes"')
    const playing = html('preview', <Video video={video} poster={photo} label="How it drapes" ratio={1.5} autoPlay />)
    expect(playing).toContain('controls')
    expect(playing).toContain('muted')
  })
})

describe('photo.ts', () => {
  it('has no client boundary and imports nothing from the client module, so a server component can call its decoders', async () => {
    const { readFile } = await import('node:fs/promises')
    const source = await readFile('src/platform/media/photo.ts', 'utf8')
    expect(source).not.toMatch(/^['"]use client['"]/)
    expect(source).not.toMatch(/from ['"]\.\/media['"]/)
  })
})

// Card #1105: a built page names a picture's copy on the asset host, and the Shop API's fresh answer names the same file.
describe('Image after a fresh answer', () => {
  afterEach(cleanup)
  const at = (url: string) => photoSchema.parse({ alt: null, image: { url } })
  const copy = 'https://sf-assets.my-store.one/stores/s1/media/0b6f6a52-1c1e-4d8a-9b6e-6f1d0c2a3b4c'
  const shown = (container: HTMLElement) => container.querySelector('img')?.getAttribute('src')

  it('keeps the address it was built with while the answer names the same file, and takes a different file at once', () => {
    const built = at(copy)
    const fresh = at('https://shop.example/shop-api/assets/0b6f6a52-1c1e-4d8a-9b6e-6f1d0c2a3b4c')
    const other = at('https://shop.example/shop-api/assets/9a8b7c6d-1c1e-4d8a-9b6e-6f1d0c2a3b4c')
    if (!built || !fresh || !other) throw new Error('no photo')
    const { container, rerender } = render(<Provided mode="live"><Image image={built} alt="" ratio={1} /></Provided>)
    rerender(<Provided mode="live"><Image image={fresh} alt="" ratio={1} /></Provided>)
    expect(shown(container)).toBe(`/cdn-cgi/image/width=960,quality=82,format=auto/${copy}`)
    rerender(<Provided mode="live"><Image image={other} alt="" ratio={1} /></Provided>)
    expect(shown(container)).toContain('/shop-api/assets/9a8b7c6d-')
  })

  it('takes at once any other address, even one ending in the same name', () => {
    const steps = ['https://a.example/img/hero.jpg', 'https://b.example/other/hero.jpg', 'https://b.example/other/hero.jpg?v=2', `https://a.example/x/${copy.slice(-36)}`]
    const photos = steps.map(at).filter((p) => p !== null)
    const [first] = photos
    if (!first || photos.length !== steps.length) throw new Error('no photo')
    const { container, rerender } = render(<Provided mode="preview"><Image image={first} alt="" ratio={1} /></Provided>)
    for (const [n, photo] of photos.entries()) {
      rerender(<Provided mode="preview"><Image image={photo} alt="" ratio={1} /></Provided>)
      expect(shown(container)).toBe(steps[n])
    }
  })
})
