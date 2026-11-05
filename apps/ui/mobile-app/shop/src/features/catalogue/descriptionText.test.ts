import { hasMarkup, plainTextOfDescription as words } from './descriptionText'

describe('a product description as plain words (#1272)', () => {
  it('separates paragraphs with a blank line and keeps a line break as one', () => {
    expect(words('<p>Soft linen.</p><p>Made in Jaipur.<br>Hand finished.</p>')).toBe('Soft linen.\n\nMade in Jaipur.\nHand finished.')
  })

  it('puts a bullet before each list item and counts a numbered one', () => {
    expect(words('<ul><li><strong>Material:</strong> 100% cotton</li><li><strong>Care:</strong> Machine wash cold</li></ul>')).toBe('•  Material: 100% cotton\n•  Care: Machine wash cold')
    expect(words('<ol><li>Wash</li><li>Dry</li><li>Fold</li></ol>')).toBe('1.  Wash\n2.  Dry\n3.  Fold')
  })

  it('keeps a blank line between a paragraph and a list, and indents a nested list', () => {
    expect(words('<p>Care</p><ul><li>Wash</li></ul><p>Done</p>')).toBe('Care\n\n•  Wash\n\nDone')
    expect(words('<ul><li>Top<ul><li>Inner one</li><li>Inner two</li></ul></li><li>Next</li></ul>')).toBe('•  Top\n  •  Inner one\n  •  Inner two\n•  Next')
  })

  it('shows a link as its words, and drops bold and italics', () => {
    expect(words('<p>Read the <a href="https://example.com/care">care guide</a> and <em>wash</em> it <strong>cold</strong>.</p>')).toBe('Read the care guide and wash it cold.')
  })

  it('decodes entities, named and numeric, and leaves an unknown one as it is', () => {
    expect(words('<p>Soft &amp; light &lt;3 &#169; &#x41; a&nbsp;b &bogus; &#0;</p>')).toBe('Soft & light <3 © A a b &bogus;')
  })

  it('drops the contents of script, style and similar tags, even one never closed', () => {
    expect(words('<p>Before</p><script>alert(1)</script><style>p{color:red}</style><iframe src="x">hidden</iframe><p>After</p>')).toBe('Before\n\nAfter')
    expect(words('<p>Before</p><script>alert(1)')).toBe('Before')
    expect(words('<p>One</p><!-- hidden --><p>Two</p>')).toBe('One\n\nTwo')
  })

  it('shows text with no block tag as it is, so a < in it stays a character', () => {
    for (const typed of ['', 'Soft cotton.\nHand wash <3 & size <XL', 'Fits waists 28 < 32 > 30 inches. Use <your size> chart &amp; more.', '<b>typed with a tag</b>']) expect(words(typed)).toBe(typed)
  })

  it('never throws on a tag that is never closed, or a stray <', () => {
    expect(words('<p>Soft <b')).toBe('Soft <b')
    expect(words('<p>1 < 2 and 3 > 2</p>')).toBe('1 < 2 and 3 > 2')
    expect(words('<ul><li>One<li>Two</ul>')).toBe('•  One\n•  Two')
    expect(words('<li>Loose</li><p>x</p>')).toBe('<li>Loose</li><p>x</p>')
  })

  it('stays quick, and in step with the input, on a list nested thousands deep', () => {
    const started = Date.now()
    const text = words(`${'<ul><li>'.repeat(5_000)}deep`)
    expect(text.length).toBeLessThan(60_000)
    expect(text).toContain('deep')
    expect(text).not.toMatch(/ {11}/)
    expect(Date.now() - started).toBeLessThan(1_000)
  })

  it('stays quick on unclosed comments, unclosed tags and stray < signs, thousands of them', () => {
    for (const unit of ['<!--', '<a ', '<', '<p ', '<ul><li ', '<script ']) {
      const started = Date.now()
      const text = words(`<p>${unit.repeat(40_000)}`)
      expect(text.length).toBeLessThan(400_000)
      expect(Date.now() - started).toBeLessThan(1_000)
    }
  })

  it('keeps what follows an unclosed tag as text, and drops what follows an unclosed comment', () => {
    expect(words('<p>One</p><p>Two <a href="x')).toBe('One\n\nTwo <a href="x')
    expect(words('<p>One</p><!-- never closed <p>Two</p>')).toBe('One')
  })

  it('says whether a description was stored as formatted text', () => {
    expect(hasMarkup('<p>Soft</p>')).toBe(true)
    expect(hasMarkup('  <ul><li>One</li></ul>')).toBe(true)
    expect(hasMarkup('Soft <b>cotton</b>')).toBe(false)
    expect(hasMarkup('')).toBe(false)
  })
})
