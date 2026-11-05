import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { textOfRichText } from '../platform/text/richText'
import { RichText } from './richText'

const RichTextHtml = (description: string) => renderToStaticMarkup(<RichText html={description} />)
const html = (description: string, className?: string) => renderToStaticMarkup(<RichText html={description} className={className} />)

describe('RichText (#1216)', () => {
  it('shows paragraphs, bold and italic text, lists and links', () => {
    expect(html('<p>Soft <strong>cotton</strong> and <em>linen</em></p><ul><li>Hand wash</li><li>Dry flat</li></ul><ol><li>One</li></ol>')).toBe(
      '<div><p>Soft <strong>cotton</strong> and <em>linen</em></p><ul><li>Hand wash</li><li>Dry flat</li></ul><ol><li>One</li></ol></div>',
    )
  })

  it('opens a link with noopener and nofollow, and only to http, https or mailto', () => {
    expect(html('<p><a href="https://example.com/care">Care</a> <a href="mailto:hi@example.com">Mail</a></p>')).toBe(
      '<div><p><a href="https://example.com/care" rel="noopener nofollow">Care</a> <a href="mailto:hi@example.com" rel="noopener nofollow">Mail</a></p></div>',
    )
    for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'java&#9;script:alert(1)', 'data:text/html,x', '/relative', 'vbscript:x']) {
      expect(html(`<p><a href="${bad}">Click</a></p>`)).toBe('<div><p>Click</p></div>')
    }
  })

  it('shows a Shopify description’s list and bold labels with no tags as text', () => {
    const rendered = html('<ul>\n<li><b>Material &amp; Construction:</b> 100% cotton</li>\n<li><b>Care:</b> Machine wash cold</li>\n</ul>\n')
    expect(rendered).toBe('<div><ul><li><strong>Material &amp; Construction:</strong> 100% cotton</li><li><strong>Care:</strong> Machine wash cold</li></ul></div>')
    expect(rendered).not.toContain('&lt;')
  })

  it('draws nothing outside the subset: scripts, event attributes, styles, images and frames', () => {
    const rendered = html('<p onclick="steal()" style="color:red">Hi</p><script>alert(1)</script><img src=x onerror=alert(1)><iframe src="https://evil.example">x</iframe><span class="y">there</span>')
    expect(rendered).toBe('<div><p>Hi</p><p>there</p></div>')
  })

  it('shows text that looks like a tag as text', () => {
    expect(html('<p>&lt;script&gt;alert(1)&lt;/script&gt; and a &lt; b</p>')).toBe('<div><p>&lt;script&gt;alert(1)&lt;/script&gt; and a &lt; b</p></div>')
    expect(html('<p>5 < 6 and <3</p>')).toBe('<div><p>5 &lt; 6 and &lt;3</p></div>')
  })

  it('shows plain text typed before the editor was rich as paragraphs and line breaks', () => {
    expect(html('Soft cotton.\nHand wash.\n\nMade in India & packed <3')).toBe('<div><p>Soft cotton.<br/>Hand wash.</p><p>Made in India &amp; packed &lt;3</p></div>')
  })

  it('keeps a nested list and the paragraphs of a list item', () => {
    expect(html('<ul><li>Fruit<ul><li>Apple</li></ul></li><li><p>One</p><p>Two</p></li></ul>')).toBe('<div><ul><li>Fruit<ul><li>Apple</li></ul></li><li>One<br/>Two</li></ul></div>')
  })

  it('draws nothing when there is nothing to read, and takes the theme’s class', () => {
    for (const empty of ['', '  \n', '<p></p>', '<p><br></p>', '<script>alert(1)</script>']) expect(html(empty)).toBe('')
    expect(html('<p>Hi</p>', 'body')).toBe('<div class="body"><p>Hi</p></div>')
  })

  it('does not stop on a long run of open tags', () => {
    expect(html(`<p>${'<b '.repeat(20_000)}`).length).toBeGreaterThan(0)
    expect(html('<ul>'.repeat(5_000))).toBe('')
    const deep = html('<ul><li>'.repeat(5_000) + 'deep')
    expect((deep.match(/<ul>/g) ?? []).length).toBeLessThanOrEqual(8)
    expect(deep).toContain('deep')
  })

  it('never inserts markup as it is', () => {
    expect(readFileSync(new URL('./richText.tsx', import.meta.url), 'utf8')).not.toMatch(/dangerouslySetInnerHTML|innerHTML/)
  })
})

describe('textOfRichText (#1216)', () => {
  it('is the description’s words with the tags gone and a space between its blocks', () => {
    expect(textOfRichText('<p>Soft <strong>cotton</strong>.</p><ul><li>Hand wash</li><li>Dry flat</li></ul><script>x()</script>')).toBe('Soft cotton. Hand wash Dry flat')
    expect(textOfRichText('<p>Fish &amp; chips</p><p>a &lt; b</p>')).toBe('Fish & chips a < b')
  })

  it('reads plain text as it is', () => {
    expect(textOfRichText('Soft cotton.\n\nHand wash.')).toBe('Soft cotton. Hand wash.')
    expect(textOfRichText('')).toBe('')
  })
})

// The API's catalog/richText.test.ts runs this file through the engine's sanitiser (#1216), so the two readers must agree.
const corpus = JSON.parse(readFileSync(new URL('./richText.corpus.json', import.meta.url), 'utf8')) as { name: string; input: string; html: string }[]

describe('RichText and the engine’s sanitiser read the same corpus alike (#1216)', () => {
  it.each(corpus)('$name', ({ input, html }) => {
    const drawn = html.replaceAll('<br>', '<br/>').replace(/<a href="([^"]*)">/g, '<a href="$1" rel="noopener nofollow">')
    expect(RichTextHtml(input)).toBe(drawn === '' ? '' : `<div>${drawn}</div>`)
    expect(RichTextHtml(html)).toBe(drawn === '' ? '' : `<div>${drawn}</div>`)
  })
})
