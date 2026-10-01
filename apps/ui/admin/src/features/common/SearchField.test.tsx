import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { messages } from '../../messages'
import { activitySearch, ipPattern } from './activitySearch'
import { SearchField } from './SearchField'

const invalid = messages.activity.filters.ipInvalid
const validate = (value: string) => (ipPattern.test(value) ? null : invalid)
const render = (value: string) => renderToString(<SearchField label="IP" placeholder="" value={value} onChange={() => undefined} validate={validate} labelVisible />)

describe('SearchField with a validator', () => {
  it('flags text the URL would drop, and ties the reason to the field', () => {
    const html = render('10.0.0.1/24')
    expect(html).toContain('aria-invalid="true"')
    const describedBy = /aria-describedby="([^"]+)"/.exec(html)?.[1]
    expect(html).toContain(`id="${describedBy}"`)
    expect(html).toContain(invalid)
  })

  it('says nothing about text the URL keeps', () => {
    const html = render('103.21')
    expect(html).toContain('aria-invalid="false"')
    expect(html).not.toContain(invalid)
  })

  it('accepts in the field exactly what the Activity log URL keeps', () => {
    const search = z.object(activitySearch)
    for (const ip of ['103.21', '2001:db8::1', '10.0.0.1/24', 'x'.repeat(46), `1${'.1'.repeat(30)}`]) {
      expect(search.parse({ ip }).ip === ip).toBe(ipPattern.test(ip))
    }
  })
})
