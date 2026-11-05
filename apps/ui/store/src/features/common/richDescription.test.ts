import { describe, expect, it } from 'vitest'
import { editorHtmlOf, plainTextOf, storedHtmlOf } from './richDescription'

describe('a product’s description for the editor (#1216)', () => {
  it('opens text typed before the editor was rich as paragraphs and line breaks', () => {
    expect(editorHtmlOf('Soft cotton.\nHand wash.\n\nMade in India & packed <3')).toBe('<p>Soft cotton.<br>Hand wash.</p><p>Made in India &amp; packed &lt;3</p>')
    expect(editorHtmlOf('')).toBe('')
  })

  it('keeps a `<` in text typed before the editor was rich as the character it was, never as a tag', () => {
    const typed = 'Pack of 2 <5kg, size <XL, a<b c>d'
    expect(editorHtmlOf(typed)).toBe('<p>Pack of 2 &lt;5kg, size &lt;XL, a&lt;b c&gt;d</p>')
    expect(plainTextOf(typed)).toBe(typed)
  })

  it('leaves a description with formatting as it is', () => {
    expect(editorHtmlOf('<p>Soft</p><ul><li>One</li></ul>')).toBe('<p>Soft</p><ul><li>One</li></ul>')
  })

  it('stores what the editor writes the way the engine does, so an unchanged description is not a change', () => {
    expect(storedHtmlOf('<p>Soft</p><p></p><p><br class="x"></p>')).toBe('<p>Soft</p>')
    expect(storedHtmlOf('<ul><li><p>One</p></li><li><p>Two</p></li></ul>')).toBe('<ul><li>One</li><li>Two</li></ul>')
    expect(storedHtmlOf('<ul><li><p>One</p><p>Two</p></li></ul>')).toBe('<ul><li><p>One</p><p>Two</p></li></ul>')
  })

  it('reads a description as plain text, for the search listing’s placeholder', () => {
    expect(plainTextOf('<p>Soft <strong>cotton</strong> &amp; linen</p><ul><li>Hand wash</li><li>Dry flat</li></ul>')).toBe('Soft cotton & linen Hand wash Dry flat')
    expect(plainTextOf('Soft cotton.\n\nHand wash.')).toBe('Soft cotton. Hand wash.')
    expect(plainTextOf('')).toBe('')
  })
})
