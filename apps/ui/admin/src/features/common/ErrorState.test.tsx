import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ErrorState, type ErrorDetails } from './ErrorState'

const details: ErrorDetails = {
  label: 'Technical details',
  codeLabel: 'Error code',
  code: 'FORBIDDEN',
  requestIdLabel: 'Request id',
  requestId: '7f3a91c2',
}
const render = (overrides: Partial<ErrorDetails>) =>
  renderToStaticMarkup(<ErrorState title="Failed" body="Try again." details={{ ...details, ...overrides }} />)

describe('ErrorState details', () => {
  it('shows the API code and the request id', () => {
    const html = render({})
    expect(html).toContain('<code>FORBIDDEN</code>')
    expect(html).toContain('<code>7f3a91c2</code>')
  })

  it('never shows a raw message passed as the code', () => {
    const html = render({ code: 'relation "store" does not exist at db/scoped.ts:42' })
    expect(html).not.toContain('relation')
    expect(html).toContain('<code>UNKNOWN</code>')
  })

  it('drops a request id that is not an id', () => {
    const html = render({ requestId: 'at Object.<anonymous> (worker.js:1:1)' })
    expect(html).not.toContain('worker.js')
    expect(html).not.toContain('Request id')
  })
})
