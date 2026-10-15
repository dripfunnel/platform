// @vitest-environment happy-dom
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Provided } from '../../../test/shop'
import type { RenderMode } from '../store/context'
import { Image, Video } from './media'
import { asMain, photoSchema, videoSchema } from './photo'

const photo = photoSchema.parse({ alt: 'Front', image: { url: 'https://shop.example/shop-api/assets/a' } })
const video = videoSchema.parse({ file: { url: 'https://shop.example/shop-api/assets/v' } })

const html = (mode: RenderMode, node: React.ReactNode) => renderToStaticMarkup(<Provided mode={mode}>{node}</Provided>)

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
  it('has no client boundary, so a server component can call its decoders', async () => {
    const { readFile } = await import('node:fs/promises')
    expect(await readFile('src/platform/media/photo.ts', 'utf8')).not.toMatch(/^['"]use client['"]/)
  })
})
