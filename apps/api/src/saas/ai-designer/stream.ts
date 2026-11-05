// The model's answer as it streams (storefront ARCHITECTURE §6.2, #1240): each item of one array of its JSON object, as
// soon as the item is whole, so the runner can pre-check a file while the model writes the next. The answer read whole
// (readAnswer) still decides; this only looks ahead, and text before the object is skipped as jsonOf skips it.

/** Feeds `onItem` each whole item of the top-level `key` array, parsed; call the result with each piece of text. */
export const streamedItems = (key: string, onItem: (item: unknown) => void): ((text: string) => void) => {
  let buffer = ''
  let scanned = 0
  let depth = 0
  let inString = false
  let escaped = false
  let stringStart = -1
  let lastString: string | null = null
  // The key whose value comes next, once its colon is read at the top level.
  let valueOf: string | null = null
  let inArray = false
  let itemStart = -1
  let done = false

  return (text) => {
    if (done) return
    buffer += text
    for (; scanned < buffer.length; scanned += 1) {
      const c = buffer[scanned]
      if (depth === 0 && c !== '{') continue
      if (inString) {
        if (escaped) escaped = false
        else if (c === '\\') escaped = true
        else if (c === '"') {
          inString = false
          if (depth === 1 && !inArray) {
            try {
              lastString = JSON.parse(buffer.slice(stringStart, scanned + 1)) as string
            } catch {
              lastString = null
            }
          }
        }
        continue
      }
      if (c === '"') {
        inString = true
        stringStart = scanned
      } else if (c === ':' && depth === 1 && !inArray) valueOf = lastString
      else if (c === '{' || c === '[') {
        if (depth === 1 && c === '[' && valueOf === key) inArray = true
        else if (inArray && depth === 2) itemStart = scanned
        depth += 1
      } else if (c === '}' || c === ']') {
        depth -= 1
        if (inArray && depth === 2 && itemStart >= 0) {
          try {
            onItem(JSON.parse(buffer.slice(itemStart, scanned + 1)))
          } catch {
            // Not JSON after all: the whole answer's reading names it.
          }
          itemStart = -1
        } else if ((inArray && depth === 1) || depth === 0) {
          done = true
          return
        }
      } else if (c === ',' && depth === 1) valueOf = null
    }
  }
}
