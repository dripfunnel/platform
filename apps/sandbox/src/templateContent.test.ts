import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { readContent } from '../../../templates/storefront/src/app/content'

const root = mkdtempSync(join(tmpdir(), 'content-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('the template shell’s readContent', () => {
  it('flattens content/{language}/{file}.json into file.key words', () => {
    mkdirSync(join(root, 'en'))
    writeFileSync(join(root, 'en', 'home.json'), JSON.stringify({ hero: { title: 'Hello {store}' }, note: 'Hi', count: 3 }))
    writeFileSync(join(root, 'en', 'readme.txt'), 'not content')
    expect(readContent(root)).toEqual({ en: { 'home.hero.title': 'Hello {store}', 'home.note': 'Hi' } })
  })
  it('throws on a folder that does not exist, and on a file that is not JSON', () => {
    expect(() => readContent(join(root, 'missing'))).toThrow()
    writeFileSync(join(root, 'en', 'bad.json'), '{ nope')
    expect(() => readContent(root)).toThrow()
  })
})
