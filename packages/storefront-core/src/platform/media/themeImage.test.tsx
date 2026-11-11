// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Provided } from '../../../test/shop'
import { ThemeImage, ThemeMediaProvider } from './themeImage'

afterEach(cleanup)

const media = { 'haldi-home.webp': '/assets/media/haldi-home-3F9A1C.webp' }

const shown = (src: string) =>
  render(
    <Provided>
      <ThemeMediaProvider media={media}>
        <ThemeImage src={src} alt="Haldi powder" ratio={1.5} />
      </ThemeMediaProvider>
    </Provided>,
  ).container.querySelector('img')

describe('ThemeImage (#1405)', () => {
  it('draws the theme image at the address the build gave for its name, lazily, with its size reserved', () => {
    const img = shown('haldi-home.webp')
    expect(img?.getAttribute('src')).toBe('/assets/media/haldi-home-3F9A1C.webp')
    expect(img?.getAttribute('alt')).toBe('Haldi powder')
    expect(img?.getAttribute('loading')).toBe('lazy')
    expect([img?.getAttribute('width'), img?.getAttribute('height')]).toEqual(['1200', '800'])
  })

  it('shows nothing for a name the build gave no address, an inherited key included', () => {
    expect(shown('missing.webp')).toBeNull()
    expect(shown('constructor')).toBeNull()
  })
})
