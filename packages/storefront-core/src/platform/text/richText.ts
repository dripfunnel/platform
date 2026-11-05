// A product's description is a small HTML subset the engine stores (#1216, apps/api catalog/richText.ts), read into a tree here.
// Pure logic: sealed/richText.tsx draws it and platform/seo and products take its text.

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
export type RichNode = { kind: 'text'; text: string } | { kind: 'br' } | { kind: 'break' } | { kind: 'el'; tag: Tag; href?: string; children: RichNode[] }

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

export const parse = (html: string): RichNode[] => {
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
export const hasMarkup = (text: string): boolean => /<\/?[a-z!]/i.test(text)

export const isBlank = (node: RichNode): boolean => (node.kind === 'text' ? node.text.trim() === '' : node.kind !== 'el' || node.children.every(isBlank))

const textOf = (nodes: readonly RichNode[]): string =>
  nodes
    .map((n): string => {
      if (n.kind === 'text') return n.text
      if (n.kind === 'el') return n.tag === 'strong' || n.tag === 'em' || n.tag === 'a' ? textOf(n.children) : ` ${textOf(n.children)} `
      return ' '
    })
    .join('')

/** The description as plain text, for a page's summary in the head and the structured data. */
export const textOfRichText = (html: string): string => (hasMarkup(html) ? textOf(parse(html)) : html).replace(/\s+/g, ' ').trim()
