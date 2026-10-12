import { describe, expect, it } from 'vitest'
import { templateChange } from './template'

const words = (title: string, lead: string) => `${JSON.stringify({ home: { title, lead } }, null, 2)}\n`

const current = new Map([
  ['src/theme/pages/HomePage.tsx', 'old page'],
  ['src/theme/pages/AboutPage.tsx', 'only in the draft'],
  ['routes.json', '{"custom":{"/our-story":"AboutPage"}}'],
  ['content/en/pages.json', words('My own title', '')],
  ['content/hi/pages.json', words('मेरा शीर्षक', 'मेरी पंक्ति')],
])
const template = [
  { path: 'src/theme/pages/HomePage.tsx', content: 'new page' },
  { path: 'routes.json', content: '{}' },
  { path: 'content/en/pages.json', content: words('Template title', 'Template lead') },
  { path: 'content/fr/pages.json', content: words('Titre', 'Ligne') },
]

const asMap = (files: ReturnType<typeof templateChange>) => new Map(files.map((f) => [f.path, f.content]))

describe('templateChange', () => {
  it('writes the template, removes the draft’s other theme files, and drops languages the store doesn’t offer', () => {
    const files = asMap(templateChange(current, template, ['en', 'hi'], false))
    expect(files.get('src/theme/pages/HomePage.tsx')).toBe('new page')
    expect(files.get('src/theme/pages/AboutPage.tsx')).toBeNull()
    expect(files.get('routes.json')).toBe('{}')
    expect(files.has('content/fr/pages.json')).toBe(false)
    expect(files.get('content/en/pages.json')).toBe(words('Template title', 'Template lead'))
  })

  it('starts a language the template lacks from its English words', () => {
    expect(asMap(templateChange(current, template, ['en', 'hi'], false)).get('content/hi/pages.json')).toBe(words('Template title', 'Template lead'))
  })

  it('keeps the draft’s words where the template has the same key and the draft has words there', () => {
    const files = asMap(templateChange(current, template, ['en', 'hi'], true))
    expect(JSON.parse(files.get('content/en/pages.json') ?? '')).toEqual({ home: { title: 'My own title', lead: 'Template lead' } })
    expect(JSON.parse(files.get('content/hi/pages.json') ?? '')).toEqual({ home: { title: 'मेरा शीर्षक', lead: 'मेरी पंक्ति' } })
  })
})
