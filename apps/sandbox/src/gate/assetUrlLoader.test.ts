import { isThemePath, mediaFolder } from '@dripfunnel/storefront-core/guard'
import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'
import { mediaUrlPlugin } from './bundle'

// The template's next dev loader writes a theme's CSS url() as a build's bundler does (storefront ARCHITECTURE §3.4).
// Plain JS for Turbopack, so it carries no types for a static import.
const loaderPath = new URL('../../../../templates/storefront/asset-url-loader.mjs', import.meta.url).href
const { default: assetUrlLoader } = (await import(loaderPath)) as { default: (css: string) => string }

describe('the template’s asset-url-loader', () => {
  it('maps an asset id to the proxied shop asset', () => {
    expect(assetUrlLoader('.a { background: url(m_hero01); }')).toBe('.a { background: url(/shop-api/assets/m_hero01); }')
    expect(assetUrlLoader('.a { background: url( "m_hero01" ); }')).toBe('.a { background: url("/shop-api/assets/m_hero01"); }')
  })

  it('maps a theme image, quoted or not, to the theme-media route', () => {
    expect(assetUrlLoader('.a { background: url(media/haldi-home.webp); }')).toBe('.a { background: url(/theme-media/haldi-home.webp); }')
    expect(assetUrlLoader(".a { background: url('media/hero.jpeg'); }")).toBe(".a { background: url('/theme-media/hero.jpeg'); }")
    expect(assetUrlLoader('.a { background: url("media/hero.png"); }')).toBe('.a { background: url("/theme-media/hero.png"); }')
  })

  it('leaves every other url() alone', () => {
    const css = [
      '.a { background: url(https://example.com/x.png); }',
      '.b { background: url("data:image/png;base64,iVBORw0KGgo="); }',
      '.c { background: url(media/hero.gif); }',
      '.d { background: url(media/sub/hero.png); }',
      '.e { background: url("m_hero01\'); }',
    ].join('\n')
    expect(assetUrlLoader(css)).toBe(css)
  })

  it('maps exactly the image names the validator accepts', () => {
    const names = ['hero.png', 'a.jpg', 'Hero_2-x.jpeg', 'h.webp', `${'a'.repeat(64)}.png`, `${'a'.repeat(65)}.png`, '-hero.png', 'hero.PNG', 'hero.gif', 'he.ro.png', 'sub/hero.png']
    for (const name of names) {
      expect(assetUrlLoader(`url(media/${name})`) === `url(/theme-media/${name})`, name).toBe(isThemePath(`${mediaFolder}${name}`))
    }
  })

  it('names an asset id’s address exactly as mediaUrlPlugin does', async () => {
    const built = await build({
      stdin: { contents: '.a { background: url(m_hero01); }', loader: 'css', resolveDir: '.' },
      bundle: true,
      write: false,
      plugins: [mediaUrlPlugin('')],
    })
    const bundled = built.outputFiles[0]?.text ?? ''
    expect(bundled).toContain(assetUrlLoader('url(m_hero01)'))
  })
})
