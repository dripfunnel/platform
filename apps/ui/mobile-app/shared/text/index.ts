// A product's description is the engine's small HTML subset (#1216, docs/ui/store/CATALOG-DESIGN.md C2); this reads it as plain words.

const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

const decode = (text: string): string =>
  text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,6});/gi, (whole, body: string) => {
    if (!body.startsWith('#')) return entities[body.toLowerCase()] ?? whole
    const code = body[1] === 'x' || body[1] === 'X' ? Number.parseInt(body.slice(2), 16) : Number(body.slice(1))
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : ''
  })

/** The engine stores formatted text as blocks, so text that starts any other way was typed before, and its `<` is a character. */
export const hasMarkup = (stored: string): boolean => /^\s*<(?:p|ul|ol)>/.test(stored)

const dropWithContent = new Set(['script', 'style', 'template', 'noscript', 'iframe', 'object', 'embed', 'textarea', 'title'])
/** Deep enough for any list a person writes, and what keeps a hostile one from growing the text. */
const maxIndent = 4
const tag = /<!--[\s\S]*?-->|<(\/?)([a-z][a-z0-9]*)\b[^>]*>/gi

export const plainTextOfDescription = (stored: string): string => {
  if (!hasMarkup(stored)) return stored
  const lists: { ordered: boolean; count: number }[] = []
  let out = ''
  // Looks only at the end of the text, so a long description is not scanned again for every tag.
  const breakTo = (lines: number) => {
    let end = out.length
    while (end > 0 && (out[end - 1] === ' ' || out[end - 1] === '\t')) end -= 1
    out = out.slice(0, end)
    if (out === '') return
    let have = 0
    while (have < lines && out[end - 1 - have] === '\n') have += 1
    if (have < lines) out += '\n'.repeat(lines - have)
  }
  tag.lastIndex = 0
  let at = 0
  for (let m = tag.exec(stored); m !== null; m = tag.exec(stored)) {
    out += decode(stored.slice(at, m.index).replace(/\s+/g, ' '))
    at = tag.lastIndex
    const [, closing, rawName] = m
    const name = rawName?.toLowerCase() ?? ''
    if (!closing && dropWithContent.has(name)) {
      const stop = new RegExp(`</${name}\\s*>`, 'gi')
      stop.lastIndex = at
      const found = stop.exec(stored)
      at = found ? found.index + found[0].length : stored.length
      tag.lastIndex = at
      continue
    }
    if (name === 'br') out += '\n'
    else if (name === 'p') breakTo(2)
    else if (name === 'ul' || name === 'ol') {
      if (closing) lists.pop()
      else lists.push({ ordered: name === 'ol', count: 0 })
      breakTo(lists.length > (closing ? 0 : 1) ? 1 : 2)
    } else if (name === 'li') {
      breakTo(1)
      if (!closing) {
        const list = lists.at(-1)
        if (list) list.count += 1
        out += `${'  '.repeat(Math.min(Math.max(lists.length - 1, 0), maxIndent))}${list?.ordered ? `${list.count}.  ` : '•  '}`
      }
    }
  }
  out += decode(stored.slice(at).replace(/\s+/g, ' '))
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}
