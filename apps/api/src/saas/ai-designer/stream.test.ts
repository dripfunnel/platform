import { describe, expect, it } from 'vitest'
import { streamedItems } from './stream'

const feed = (text: string, size: number) => {
  const items: unknown[] = []
  const push = streamedItems('files', (item) => void items.push(item))
  for (let at = 0; at < text.length; at += size) push(text.slice(at, at + size))
  return items
}

describe('the answer’s files as they stream (#1240)', () => {
  const files = [
    { path: 'src/theme/pages/HomePage.tsx', edits: [{ search: 'a "quoted" {brace} [x]', replace: 'b \\ "c" }' }] },
    { path: 'content/en/home.json', content: '{"hero":{"title":"Hi"}}' },
    { path: 'src/theme/styles/old.module.css', delete: true },
  ]
  const answer = `Here is "my" [answer]: ${JSON.stringify({ reply: 'files', files, changed: ['Hero'], page: null, more: [{ path: 'not a file' }] }, null, 1)}`

  it('hands over each file whole as soon as it closes, however the text is cut', () => {
    for (const size of [1, 3, 7, 64, answer.length]) expect(feed(answer, size)).toEqual(files)
  })

  it('reads only the top-level files array: never a nested one, a value named files, or anything after it', () => {
    const nested = JSON.stringify({ plan: { files: [{ path: 'x' }] }, reply: 'r' })
    expect(feed(nested, 5)).toEqual([])
    const after = `${JSON.stringify({ files: [{ path: 'a', delete: true }] })} {"files":[{"path":"b","delete":true}]}`
    expect(feed(after, 4)).toEqual([{ path: 'a', delete: true }])
  })

  it('gives nothing for an answer cut off inside a file', () => {
    const cut = JSON.stringify({ files }).slice(0, 60)
    expect(feed(cut, 10)).toEqual([])
  })
})
