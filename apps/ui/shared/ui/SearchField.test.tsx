import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SearchField } from './SearchField'

const invalid = 'Enter an IP address or range'
const validate = (value: string) => (/^[0-9a-f.:/]+$/i.test(value) ? null : invalid)
const render = (value: string) => renderToString(<SearchField label="IP" placeholder="" value={value} onChange={() => undefined} validate={validate} labelVisible />)

describe('SearchField with a validator', () => {
  it('flags text the URL would drop, and ties the reason to the field', () => {
    const html = render('not an address')
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
})
