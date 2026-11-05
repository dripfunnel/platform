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
const tagStart = /<(\/?)([a-z][a-z0-9]*)\b/iy

export const plainTextOfDescription = (stored: string): string => {
  if (!hasMarkup(stored)) return stored
  const lists: { ordered: boolean; count: number }[] = []
  // The text is kept in parts and only its last few characters are ever read: reading the end of one long string each time is quadratic.
  const parts: string[] = []
  const add = (text: string) => {
    if (text !== '') parts.push(text)
  }
  const breakTo = (lines: number) => {
    while (parts.length > 0) {
      const last = parts[parts.length - 1] ?? ''
      const trimmed = last.replace(/[ \t]+$/, '')
      if (trimmed === '') parts.pop()
      else {
        parts[parts.length - 1] = trimmed
        break
      }
    }
    if (parts.length === 0) return
    let have = 0
    for (let i = parts.length - 1; i >= 0 && have < lines; i -= 1) {
      const part = parts[i] ?? ''
      let j = part.length - 1
      while (j >= 0 && part[j] === '\n' && have < lines) {
        have += 1
        j -= 1
      }
      if (j >= 0) break
    }
    if (have < lines) add('\n'.repeat(lines - have))
  }
  // A search that finds no end ends the scan: nothing after it could have one either, so the work stays linear.
  let at = 0
  while (at < stored.length) {
    const lt = stored.indexOf('<', at)
    if (lt === -1) break
    add(decode(stored.slice(at, lt).replace(/\s+/g, ' ')))
    at = lt
    if (stored.startsWith('<!--', lt)) {
      const close = stored.indexOf('-->', lt + 4)
      at = close === -1 ? stored.length : close + 3
      continue
    }
    tagStart.lastIndex = lt
    const m = tagStart.exec(stored)
    if (!m) {
      add('<')
      at = lt + 1
      continue
    }
    const gt = stored.indexOf('>', lt + m[0].length)
    if (gt === -1) break
    at = gt + 1
    const [, closing, rawName] = m
    const name = rawName?.toLowerCase() ?? ''
    if (!closing && dropWithContent.has(name)) {
      const stop = new RegExp(`</${name}\\s*>`, 'gi')
      stop.lastIndex = at
      const found = stop.exec(stored)
      at = found ? found.index + found[0].length : stored.length
      continue
    }
    if (name === 'br') add('\n')
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
        add(`${'  '.repeat(Math.min(Math.max(lists.length - 1, 0), maxIndent))}${list?.ordered ? `${list.count}.  ` : '•  '}`)
      }
    }
  }
  add(decode(stored.slice(at).replace(/\s+/g, ' ')))
  return parts.join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}
