// A product description is a small HTML subset (#1216): p, br, strong, em, ul, ol, li and a (http, https, mailto).
// The output is built from the allowlist, never copied from the input, so nothing else can get through.

const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

const decode = (text: string): string =>
  text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,6});/gi, (whole, body: string) => {
    if (body.startsWith('#')) {
      const code = body[1] === 'x' || body[1] === 'X' ? Number.parseInt(body.slice(2), 16) : Number(body.slice(1))
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : ''
    }
    return entities[body.toLowerCase()] ?? whole
  })

const escapeText = (text: string): string => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
const escapeAttribute = (text: string): string => escapeText(text).replaceAll('"', '&quot;')

type Tag = 'p' | 'strong' | 'em' | 'a' | 'ul' | 'ol' | 'li'
type RichNode = { kind: 'text'; text: string } | { kind: 'br' } | { kind: 'break' } | { kind: 'el'; tag: Tag; href?: string; children: RichNode[] }

const aliases: Record<string, Tag | undefined> = { p: 'p', strong: 'strong', b: 'strong', em: 'em', i: 'em', a: 'a', ul: 'ul', ol: 'ol', li: 'li' }
const inlineTags = new Set<Tag>(['strong', 'em', 'a'])
/** Tags whose own text is not content. */
const dropWithContent = new Set(['script', 'style', 'template', 'noscript', 'iframe', 'object', 'embed', 'textarea', 'title'])
/** Not allowed, but each starts a new line of text, so what is around it must not run together. */
const blockTags = new Set(['div', 'section', 'article', 'header', 'footer', 'aside', 'blockquote', 'pre', 'table', 'tr', 'tbody', 'thead', 'tfoot', 'hr', 'dl', 'dt', 'dd', 'figure', 'figcaption', 'address', 'main', 'nav', 'form', 'fieldset', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'])

const safeHref = (raw: string): string | null => {
  // Browsers ignore tabs and newlines inside a scheme (`java\tscript:`), so they go before the scheme is read.
  // eslint-disable-next-line no-control-regex
  const href = decode(raw).replace(/[\x00-\x1f\x7f-\x9f]/g, '').trim().replaceAll(' ', '%20')
  return /^(https?:\/\/[^/?#]|mailto:.)/i.test(href) ? href : null
}

const attributePattern = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g

const hrefOf = (attributes: string): string | null => {
  for (const m of attributes.matchAll(attributePattern)) if (m[1]?.toLowerCase() === 'href') return safeHref(m[2] ?? m[3] ?? m[4] ?? '')
  return null
}

const tagStart = /<(\/?)([a-z][a-z0-9]*)/iy
/** Deep enough for any list a person writes, and what keeps the recursion below short. */
const maxDepth = 8
const endOf = new Map<string, RegExp>()

const parse = (html: string): RichNode[] => {
  let quotesBroken = false
  /** The `>` that ends a tag, past any quoted `>`; once a quote is never closed, the next `>`, so each scan stays linear. */
  const tagEnd = (text: string, from: number): number => {
    if (!quotesBroken) {
      let quote = ''
      for (let i = from; i < text.length; i++) {
        const c = text[i]
        if (quote) quote = c === quote ? '' : quote
        else if (c === '"' || c === "'") quote = c
        else if (c === '>') return i
      }
      quotesBroken = true
    }
    return text.indexOf('>', from)
  }
  const root: RichNode[] = []
  const stack: { tag: Tag; children: RichNode[] }[] = []
  const top = (): RichNode[] => stack.at(-1)?.children ?? root
  const open = (tag: Tag, href?: string) => {
    if (stack.length >= maxDepth) return
    const node: RichNode = { kind: 'el', tag, ...(href === undefined ? {} : { href }), children: [] }
    top().push(node)
    stack.push({ tag, children: node.children })
  }
  const closeTo = (tags: ReadonlySet<Tag>) => {
    while (stack.length > 0 && !tags.has(stack[stack.length - 1]?.tag as Tag)) stack.pop()
  }
  const closeInline = () => {
    while (stack.length > 0 && (inlineTags.has(stack[stack.length - 1]?.tag as Tag) || stack[stack.length - 1]?.tag === 'p')) stack.pop()
  }
  const blockBreak = () => {
    closeInline()
    top().push({ kind: 'break' })
  }

  let at = 0
  while (at < html.length) {
    const lt = html.indexOf('<', at)
    const end = lt === -1 ? html.length : lt
    if (end > at) top().push({ kind: 'text', text: decode(html.slice(at, end)) })
    if (lt === -1) break
    if (html.startsWith('<!--', lt)) {
      const close = html.indexOf('-->', lt + 4)
      at = close === -1 ? html.length : close + 3
      continue
    }
    tagStart.lastIndex = lt
    const m = tagStart.exec(html)
    const gt = m ? tagEnd(html, lt + m[0].length) : -1
    if (!m || gt === -1) {
      // Not a tag, or one never closed: its characters are text, which is written escaped.
      top().push({ kind: 'text', text: m ? html.slice(lt) : '<' })
      at = m ? html.length : lt + 1
      continue
    }
    const [, closing, rawName = ''] = m
    const attributes = html.slice(lt + m[0].length, gt)
    at = gt + 1
    const name = rawName.toLowerCase()
    if (!closing && dropWithContent.has(name)) {
      const stop = endOf.get(name) ?? new RegExp(`</${name}\\s*>`, 'gi')
      endOf.set(name, stop)
      stop.lastIndex = at
      const found = stop.exec(html)
      at = found ? found.index + found[0].length : html.length
      continue
    }
    if (name === 'br') {
      if (!closing) top().push({ kind: 'br' })
      continue
    }
    const tag = aliases[name]
    if (!tag) {
      if (blockTags.has(name)) blockBreak()
      continue
    }
    if (closing) {
      const index = stack.findLastIndex((s) => s.tag === tag)
      if (index !== -1) stack.length = index
      continue
    }
    if (tag === 'p') {
      closeTo(new Set<Tag>(['li']))
      open('p')
    } else if (tag === 'ul' || tag === 'ol') {
      closeInline()
      open(tag)
    } else if (tag === 'li') {
      closeTo(new Set<Tag>(['ul', 'ol']))
      if (stack.length === 0) blockBreak()
      else open('li')
    } else if (tag === 'a') {
      const href = hrefOf(attributes)
      if (href !== null && !stack.some((s) => s.tag === 'a')) open('a', href)
    } else if (!stack.some((s) => s.tag === tag)) {
      open(tag)
    }
  }
  return root
}

const isBlank = (node: RichNode): boolean => (node.kind === 'text' ? node.text.trim() === '' : node.kind !== 'el' || node.children.every(isBlank))

const inline = (nodes: readonly RichNode[]): string => {
  const out = nodes.map((n): string => {
    if (n.kind === 'text') return escapeText(n.text.replace(/\s+/g, ' '))
    if (n.kind === 'br') return '<br>'
    if (n.kind === 'break') return '<br>'
    if (n.tag === 'a' && n.href !== undefined) return isBlank(n) ? '' : `<a href="${escapeAttribute(n.href)}">${inline(n.children)}</a>`
    return n.tag === 'strong' || n.tag === 'em' ? (isBlank(n) ? '' : `<${n.tag}>${inline(n.children)}</${n.tag}>`) : inline(n.children)
  })
  return out
    .join('')
    .replace(/ {2,}/g, ' ')
    .replace(/^(?: |<br>)+|(?: |<br>)+$/g, '')
}

const listItems = (nodes: readonly RichNode[]): string => {
  const items: string[] = []
  let loose: RichNode[] = []
  const flush = () => {
    const text = inline(loose)
    if (text) items.push(`<li>${text}</li>`)
    loose = []
  }
  for (const n of nodes) {
    if (n.kind === 'el' && n.tag === 'li') {
      flush()
      items.push(item(n.children))
    } else loose.push(n)
  }
  flush()
  return items.join('')
}

const item = (nodes: readonly RichNode[]): string => {
  const parts: string[] = []
  let run: RichNode[] = []
  const flush = () => {
    const text = inline(run)
    if (text) parts.push(text)
    run = []
  }
  for (const n of nodes) {
    if (n.kind === 'el' && (n.tag === 'ul' || n.tag === 'ol')) {
      flush()
      const nested = listItems(n.children)
      if (nested) parts.push(`<${n.tag}>${nested}</${n.tag}>`)
    } else if (n.kind === 'el' && n.tag === 'p') {
      flush()
      const text = inline(n.children)
      if (text) parts.push(text)
    } else run.push(n)
  }
  flush()
  const joined = parts.reduce((all, part) => (all === '' ? part : all.endsWith('</ul>') || all.endsWith('</ol>') || part.startsWith('<ul>') || part.startsWith('<ol>') ? all + part : `${all}<br>${part}`), '')
  return joined && `<li>${joined}</li>`
}

const blocks = (nodes: readonly RichNode[]): string => {
  const out: string[] = []
  let run: RichNode[] = []
  const flush = () => {
    const text = inline(run)
    if (text) out.push(`<p>${text}</p>`)
    run = []
  }
  for (const n of nodes) {
    if (n.kind === 'break') flush()
    else if (n.kind === 'el' && n.tag === 'p') {
      flush()
      const text = inline(n.children)
      if (text) out.push(`<p>${text}</p>`)
    } else if (n.kind === 'el' && (n.tag === 'ul' || n.tag === 'ol')) {
      flush()
      const items = listItems(n.children)
      if (items) out.push(`<${n.tag}>${items}</${n.tag}>`)
    } else run.push(n)
  }
  flush()
  return out.join('')
}

/** Descriptions typed before the editor was rich are plain text: no tag in them at all. */
const hasMarkup = (text: string): boolean => /<\/?[a-z!]/i.test(text)

const plainParagraphs = (text: string): string =>
  text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p !== '')
    .map((p) => `<p>${escapeText(p).replaceAll('\n', '<br>')}</p>`)
    .join('')

/** What the engine stores for a description: only the subset above, well formed, and empty when nothing is left to read. */
export const sanitiseDescription = (input: string): string => (hasMarkup(input) ? blocks(parse(input)) : plainParagraphs(input))
