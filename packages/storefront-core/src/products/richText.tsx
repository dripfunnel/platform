import { createElement, Fragment, type ReactNode } from 'react'
import { hasMarkup, isBlank, parse, type RichNode } from '../platform/text/richText'

// A product's description is a small HTML subset the engine stores (#1216, apps/api catalog/richText.ts).
// It is drawn as React elements here, never inserted as markup, so nothing outside the subset can render.

const inline = (nodes: readonly RichNode[]): ReactNode[] => {
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
  out.forEach((n, i) => {
    const before = out[i - 1]
    if (typeof n === 'string' && typeof before === 'string' && before.endsWith(' ')) out[i] = n.trimStart()
  })
  const first = out[0]
  if (typeof first === 'string') out[0] = first.trimStart()
  const last = out.at(-1)
  if (typeof last === 'string') out[out.length - 1] = last.trimEnd()
  return out.filter((n) => n !== null && n !== '')
}

const item = (nodes: readonly RichNode[], key: number): ReactNode => {
  const parts: { nested: boolean; node: ReactNode }[] = []
  let run: RichNode[] = []
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

const list = (node: Extract<RichNode, { kind: 'el' }>, key: number): ReactNode => {
  const items: ReactNode[] = []
  let loose: RichNode[] = []
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

const blocks = (nodes: readonly RichNode[]): ReactNode[] => {
  const out: ReactNode[] = []
  let run: RichNode[] = []
  const paragraph = (children: readonly RichNode[]) => {
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

/** A product's description as paragraphs, lists and links; nothing when there is nothing to read (storefront ARCHITECTURE §3.4 "Formatted text"). */
export const RichText = ({ html, className }: RichTextProps) => {
  const body = hasMarkup(html) ? blocks(parse(html)) : plainBlocks(html)
  return body.length > 0 ? createElement('div', { className }, ...body) : null
}

