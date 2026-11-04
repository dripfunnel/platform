import { createElement, Fragment, type ReactNode } from 'react'

// A product's description is a small HTML subset the engine stores (#1216, apps/api catalog/richText.ts).
// It is read into React elements here, never inserted as markup, so nothing outside the subset can render.

const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

const decode = (text: string): string =>
  text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,6});/gi, (whole, body: string) => {
    if (body.startsWith('#')) {
      const code = body[1] === 'x' || body[1] === 'X' ? Number.parseInt(body.slice(2), 16) : Number(body.slice(1))
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : ''
    }
    return entities[body.toLowerCase()] ?? whole
  })

type Tag = 'p' | 'strong' | 'em' | 'a' | 'ul' | 'ol' | 'li'
type Node = { kind: 'text'; text: string } | { kind: 'br' } | { kind: 'break' } | { kind: 'el'; tag: Tag; href?: string; children: Node[] }

const aliases: Record<string, Tag | undefined> = { p: 'p', strong: 'strong', b: 'strong', em: 'em', i: 'em', a: 'a', ul: 'ul', ol: 'ol', li: 'li' }
const inlineTags = new Set<Tag>(['strong', 'em', 'a'])
const dropWithContent = new Set(['script', 'style', 'template', 'noscript', 'iframe', 'object', 'embed', 'textarea', 'title'])
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

const parse = (html: string): Node[] => {
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
  const root: Node[] = []
  const stack: { tag: Tag; children: Node[] }[] = []
  const top = (): Node[] => stack.at(-1)?.children ?? root
  const open = (tag: Tag, href?: string) => {
    if (stack.length >= maxDepth) return
    const node: Node = { kind: 'el', tag, ...(href === undefined ? {} : { href }), children: [] }
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

/** Descriptions typed before the editor was rich are plain text: no tag in them at all. */
const hasMarkup = (text: string): boolean => /<\/?[a-z!]/i.test(text)

const isBlank = (node: Node): boolean => (node.kind === 'text' ? node.text.trim() === '' : node.kind !== 'el' || node.children.every(isBlank))

const inline = (nodes: readonly Node[]): ReactNode[] => {
  if (nodes.every(isBlank)) return []
  const lines = nodes.slice(nodes.findIndex((n) => n.kind !== 'br'), nodes.findLastIndex((n) => n.kind !== 'br') + 1)
  const out: ReactNode[] = lines.map((n, i) => {
    if (n.kind === 'text') return n.text.replace(/\s+/g, ' ')
    if (n.kind !== 'el') return createElement('br', { key: i })
    if (isBlank(n)) return null
    const children = inline(n.children)
    if (n.tag === 'a') return createElement('a', { key: i, href: n.href, rel: 'noopener nofollow' }, ...children)
    return n.tag === 'strong' || n.tag === 'em' ? createElement(n.tag, { key: i }, ...children) : createElement(Fragment, { key: i }, ...children)
  })
  const first = out[0]
  if (typeof first === 'string') out[0] = first.trimStart()
  const last = out.at(-1)
  if (typeof last === 'string') out[out.length - 1] = last.trimEnd()
  return out.filter((n) => n !== null && n !== '')
}

const item = (nodes: readonly Node[], key: number): ReactNode => {
  const parts: { nested: boolean; node: ReactNode }[] = []
  let run: Node[] = []
  const flush = () => {
    const text = inline(run)
    if (text.length > 0) parts.push({ nested: false, node: createElement(Fragment, { key: parts.length }, ...text) })
    run = []
  }
  for (const n of nodes) {
    if (n.kind === 'el' && (n.tag === 'ul' || n.tag === 'ol')) {
      flush()
      const rendered = list(n, parts.length)
      if (rendered) parts.push({ nested: true, node: rendered })
    } else if (n.kind === 'el' && n.tag === 'p') {
      flush()
      run = n.children
      flush()
    } else run.push(n)
  }
  flush()
  const children = parts.flatMap((part, i) => (i > 0 && !part.nested && !parts[i - 1]?.nested ? [createElement('br', { key: `br${i}` }), part.node] : [part.node]))
  return children.length > 0 ? createElement('li', { key }, ...children) : null
}

const list = (node: Extract<Node, { kind: 'el' }>, key: number): ReactNode => {
  const items: ReactNode[] = []
  let loose: Node[] = []
  const flush = () => {
    if (loose.length > 0) items.push(item(loose, items.length))
    loose = []
  }
  for (const n of node.children) {
    if (n.kind === 'el' && n.tag === 'li') {
      flush()
      items.push(item(n.children, items.length))
    } else loose.push(n)
  }
  flush()
  const kept = items.filter((i) => i !== null)
  return kept.length > 0 ? createElement(node.tag, { key }, ...kept) : null
}

const blocks = (nodes: readonly Node[]): ReactNode[] => {
  const out: ReactNode[] = []
  let run: Node[] = []
  const paragraph = (children: readonly Node[]) => {
    const text = inline(children)
    if (text.length > 0) out.push(createElement('p', { key: out.length }, ...text))
  }
  const flush = () => {
    paragraph(run)
    run = []
  }
  for (const n of nodes) {
    if (n.kind === 'break') flush()
    else if (n.kind === 'el' && n.tag === 'p') {
      flush()
      paragraph(n.children)
    } else if (n.kind === 'el' && (n.tag === 'ul' || n.tag === 'ol')) {
      flush()
      const rendered = list(n, out.length)
      if (rendered) out.push(rendered)
    } else run.push(n)
  }
  flush()
  return out
}

const plainBlocks = (text: string): ReactNode[] =>
  text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p !== '')
    .map((p, i) => createElement('p', { key: i }, ...p.split('\n').flatMap((line, n) => (n === 0 ? [line] : [createElement('br', { key: `br${n}` }), line]))))

export type RichTextProps = {
  /** The product's description as the Shop API gives it. */
  html: string
  className?: string | undefined
}

/**
 * A product's description with its paragraphs, bold and italic text, lists and links (storefront ARCHITECTURE §3.5).
 * A theme places it and styles its elements with its own CSS; only a link to http, https or mailto is kept, and it
 * opens with `rel="noopener nofollow"`. Renders nothing when there is nothing to read.
 */
export const RichText = ({ html, className }: RichTextProps) => {
  const body = hasMarkup(html) ? blocks(parse(html)) : plainBlocks(html)
  return body.length > 0 ? createElement('div', { className }, ...body) : null
}

const textOf = (nodes: readonly Node[]): string =>
  nodes
    .map((n): string => {
      if (n.kind === 'text') return n.text
      if (n.kind === 'el') return n.tag === 'strong' || n.tag === 'em' || n.tag === 'a' ? textOf(n.children) : ` ${textOf(n.children)} `
      return ' '
    })
    .join('')

/** The description as plain text, for a page's summary in the head and the structured data. */
export const textOfRichText = (html: string): string => (hasMarkup(html) ? textOf(parse(html)) : html).replace(/\s+/g, ' ').trim()
