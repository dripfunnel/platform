import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { messages } from '../../messages'
import { partnerConsoleUrl } from '../../partnerConsole'
import { SupportEnter } from './SupportEnter'

const words = messages.supportSession
const textOf = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&#x27;/g, '’').replace(/&amp;/g, '&')
const noop = () => undefined
const never = () => new Promise<boolean>(() => undefined)

describe('the support link’s page (#1112)', () => {
  it('says it is opening the store, and never puts the token in the page', () => {
    const token = 'sp.secret-token-value'
    const html = renderToString(<SupportEnter token={token} replaceUrl={noop} exchange={never} />)
    expect(textOf(html)).toContain(words.pending)
    expect(html).toContain('role="status"')
    expect(html).not.toContain(token)
  })

  it('shows that a link without a token no longer works, back to the partner console', () => {
    const html = renderToString(<SupportEnter token={undefined} replaceUrl={noop} exchange={never} />)
    expect(textOf(html)).toContain(words.invalid.title)
    expect(textOf(html)).toContain(words.invalid.body)
    expect(html).toContain(`href="${partnerConsoleUrl}"`)
  })
})
