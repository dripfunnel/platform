import { describe, expect, it } from 'vitest'
import { isPublicAsset } from './verify'

describe('isPublicAsset', () => {
  it('sends the hashed JS, CSS and theme images to the asset host, and nothing else (#1405)', () => {
    expect(['assets/entry-AB12.js', 'assets/chunk-CD34.css', 'assets/media-0123456789abcdef.webp', 'assets/media-0123456789abcdef.png', 'assets/media-0123456789abcdef.jpg'].every(isPublicAsset)).toBe(true)
    expect(['index.html', 'sitemap.xml', 'assets/media-0123456789abcdef.svg', 'assets/photo.webp', 'media-0123456789abcdef.webp', 'assets/media-0123456789ABCDEF.webp'].some(isPublicAsset)).toBe(false)
  })
})
