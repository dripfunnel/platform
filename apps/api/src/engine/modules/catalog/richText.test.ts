import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { sanitiseDescription as clean } from './richText'

// The same file runs through storefront-core's RichText (sealed/richText.test.tsx), so the two readers cannot drift apart.
const corpus = JSON.parse(readFileSync(new URL('./richText.corpus.json', import.meta.url), 'utf8')) as { name: string; input: string; html: string }[]

describe('sanitiseDescription (#1216)', () => {
  it('keeps the allowed formatting', () => {
    const html = '<p>Soft <strong>cotton</strong> and <em>linen</em></p><ul><li>Hand wash</li><li>Dry flat</li></ul><ol><li>One</li></ol><p><a href="https://example.com/care">Care</a><br>Contact <a href="mailto:hi@example.com">us</a></p>'
    expect(clean(html)).toBe(html)
  })

  it('writes b and i as strong and em', () => {
    expect(clean('<p><b>Bold</b> <i>italic</i></p>')).toBe('<p><strong>Bold</strong> <em>italic</em></p>')
  })

  it('removes script and style with what is inside them', () => {
    expect(clean('<p>Hi</p><script>alert(1)</script><style>p{color:red}</style><p>There</p>')).toBe('<p>Hi</p><p>There</p>')
    expect(clean('<p>Hi<SCRIPT type="text/javascript">alert(1)</SCRIPT></p>')).toBe('<p>Hi</p>')
  })

  it('removes event attributes and styles from allowed tags', () => {
    expect(clean('<p onclick="steal()" style="color:red" class="x">Hi <strong onmouseover="x()">there</strong></p>')).toBe('<p>Hi <strong>there</strong></p>')
    expect(clean('<a href="https://example.com" onclick="steal()" target="_blank">Go</a>')).toBe('<p><a href="https://example.com">Go</a></p>')
  })

  it('removes a link whose address is not http, https or mailto, and keeps its words', () => {
    expect(clean('<a href="javascript:alert(1)">Click</a>')).toBe('<p>Click</p>')
    expect(clean('<a href="JaVaScRiPt:alert(1)">Click</a>')).toBe('<p>Click</p>')
    expect(clean('<a href="java&#9;script:alert(1)">Click</a>')).toBe('<p>Click</p>')
    expect(clean('<a href="&#106;avascript:alert(1)">Click</a>')).toBe('<p>Click</p>')
    expect(clean('<a href="data:text/html,<script>alert(1)</script>">Click</a>')).toBe('<p>Click</p>')
    expect(clean('<a href="/relative">Click</a>')).toBe('<p>Click</p>')
    expect(clean('<a>No address</a>')).toBe('<p>No address</p>')
  })

  it('keeps an address with a quote in it from closing the attribute', () => {
    expect(clean('<a href=\'https://example.com/?q="x" onclick="y"\'>Go</a>')).toBe('<p><a href="https://example.com/?q=&quot;x&quot;%20onclick=&quot;y&quot;">Go</a></p>')
  })

  it('removes unknown tags and keeps their words', () => {
    expect(clean('<p>A <span style="x">span</span> and <u>underline</u> and <img src=x onerror=alert(1)> done</p>')).toBe('<p>A span and underline and done</p>')
    expect(clean('<iframe src="https://evil.example">inside</iframe><p>Text</p>')).toBe('<p>Text</p>')
  })

  it('starts a new paragraph at the blocks it does not allow', () => {
    expect(clean('<h2>Care</h2><ul><li>Hand wash</li></ul><div>Dry flat</div>Done')).toBe('<p>Care</p><ul><li>Hand wash</li></ul><p>Dry flat</p><p>Done</p>')
  })

  it('reads a Shopify description with a list and bold labels', () => {
    const shopify = '<ul>\n<li><b>Material &amp; Construction:</b> 100% cotton</li>\n<li><b>Care:</b> Machine wash cold</li>\n</ul>\n'
    expect(clean(shopify)).toBe('<ul><li><strong>Material &amp; Construction:</strong> 100% cotton</li><li><strong>Care:</strong> Machine wash cold</li></ul>')
  })

  it('writes text it reads as tags back as text', () => {
    expect(clean('<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; 5 &gt; 3</p>')).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; 5 &gt; 3</p>')
    expect(clean('<p>Hi</p><p>a < b and c</p>')).toBe('<p>Hi</p><p>a &lt; b and c</p>')
  })

  it('closes what was left open and ignores a stray closing tag', () => {
    expect(clean('<p>One <strong>bold</p></strong></em><p>Two')).toBe('<p>One <strong>bold</strong></p><p>Two</p>')
    expect(clean('<ul><li>One<li>Two</ul>')).toBe('<ul><li>One</li><li>Two</li></ul>')
  })

  it('keeps a nested list', () => {
    expect(clean('<ul><li>Fruit<ul><li>Apple</li></ul></li><li>Veg</li></ul>')).toBe('<ul><li>Fruit<ul><li>Apple</li></ul></li><li>Veg</li></ul>')
  })

  it('writes the paragraphs inside a list item as one line each', () => {
    expect(clean('<ul><li><p>One</p><p>Two</p></li></ul>')).toBe('<ul><li>One<br>Two</li></ul>')
  })

  it('is empty when nothing is left to read', () => {
    expect(clean('')).toBe('')
    expect(clean('  \n ')).toBe('')
    expect(clean('<p></p>')).toBe('')
    expect(clean('<p><br></p><p> </p><ul><li></li></ul>')).toBe('')
    expect(clean('<script>alert(1)</script>')).toBe('')
  })

  it('reads text with no tags as paragraphs and line breaks', () => {
    expect(clean('Soft cotton.\nHand wash.\n\nMade in India & packed <3')).toBe('<p>Soft cotton.<br>Hand wash.</p><p>Made in India &amp; packed &lt;3</p>')
    expect(clean('Line one\r\n\r\nLine two')).toBe('<p>Line one</p><p>Line two</p>')
  })

  it('gives the same result when it is run again', () => {
    for (const html of ['<p>Soft &amp; <strong>light</strong></p><ul><li>One<ul><li>Two</li></ul></li></ul>', '<p>a &lt; b</p>', '<p><a href="https://example.com/?a=1&amp;b=2">x</a></p>', 'Plain\n\ntext']) {
      const once = clean(html)
      expect(clean(once)).toBe(once)
    }
  })

  it('does not hang on a long run of open angle brackets or an unclosed tag', () => {
    expect(clean('<'.repeat(50_000))).toBe(`<p>${'&lt;'.repeat(50_000)}</p>`)
    expect(clean(`<p>${'<b '.repeat(20_000)}`)).toBe(`<p>${'&lt;b '.repeat(20_000).trim()}</p>`)
  })
})

describe('the shared corpus (#1216)', () => {
  it.each(corpus)('$name', ({ input, html }) => {
    expect(clean(input)).toBe(html)
    expect(clean(html)).toBe(html)
  })
})
