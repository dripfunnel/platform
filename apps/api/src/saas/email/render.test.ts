import { describe, expect, it } from 'vitest'
import { en } from './messages'
import { renderEmail, type Brand } from './render'
import { fromAddresses } from './sender'

const brand: Brand = { name: 'Northstar', primary: '#123456', accent: '#ffcc00', supportEmail: 'help@northstar.example', supportUrl: null, poweredBy: true }

describe('renderEmail', () => {
  it('writes the same words as text and as escaped HTML, with the support line and Powered by', () => {
    const out = renderEmail(brand, { subject: 'S', heading: 'Hi <you>', paragraphs: ['A & B'], action: { label: 'Go', url: 'https://x.example/?token=a"b' }, note: 'Once.' }, en.footer)
    expect(out.text).toBe(['Northstar', '', 'Hi <you>', '', 'A & B', '', 'Go: https://x.example/?token=a"b', '', 'Once.', '', '--', 'Questions? Contact help@northstar.example.', 'Powered by DripFunnel'].join('\n'))
    expect(out.html).toContain('Hi &lt;you&gt;')
    expect(out.html).toContain('A &amp; B')
    expect(out.html).toContain('href="https://x.example/?token=a&quot;b"')
    expect(out.html).not.toContain('<you>')
  })

  it("puts readable text on the partner's accent, and ignores a colour that isn't one", () => {
    expect(renderEmail(brand, { subject: 'S', heading: 'H', paragraphs: [], action: { label: 'Go', url: 'https://x.example' } }, en.footer).html).toContain('background:#ffcc00;color:#14181f')
    const odd = renderEmail({ ...brand, accent: 'red;background:url(x)' }, { subject: 'S', heading: 'H', paragraphs: [], action: { label: 'Go', url: 'https://x.example' } }, en.footer).html
    expect(odd).not.toContain('url(x)')
  })

  it('leaves out the footer lines a brand has no value for', () => {
    expect(renderEmail({ ...brand, supportEmail: null, poweredBy: false }, { subject: 'S', heading: 'H', paragraphs: [] }, en.footer).text).not.toContain('--')
  })
})

describe('fromAddresses', () => {
  it("sends DripFunnel's own email from the sender domain and a partner's from its label's subdomain", () => {
    expect(fromAddresses({ kind: 'dripfunnel' }, { ...brand, name: 'DripFunnel' }, 'dripfunnel-mail.com')).toEqual(['"DripFunnel" <no-reply@dripfunnel-mail.com>'])
    expect(fromAddresses({ kind: 'partner', label: 'northstar', emailHost: null }, brand, 'dripfunnel-mail.com')).toEqual(['"Northstar" <no-reply@northstar.dripfunnel-mail.com>'])
    expect(fromAddresses({ kind: 'partner', label: null, emailHost: null }, brand, 'dripfunnel-mail.com')).toEqual(['"Northstar" <no-reply@dripfunnel-mail.com>'])
  })

  it("prefers a partner's live Email sender, keeping the name, with the fallback behind it (#1579)", () => {
    expect(fromAddresses({ kind: 'partner', label: 'northstar', emailHost: 'mail.northstar.com' }, brand, 'dripfunnel-mail.com')).toEqual([
      '"Northstar" <no-reply@mail.northstar.com>',
      '"Northstar" <no-reply@northstar.dripfunnel-mail.com>',
    ])
  })

  it('quotes a display name and encodes one that is not ASCII', () => {
    expect(fromAddresses({ kind: 'dripfunnel' }, { ...brand, name: 'Say "hi"' }, 'd.example')).toEqual(['"Say \\"hi\\"" <no-reply@d.example>'])
    expect(fromAddresses({ kind: 'dripfunnel' }, { ...brand, name: 'Müller' }, 'd.example')).toEqual(['=?UTF-8?B?TcO8bGxlcg==?= <no-reply@d.example>'])
  })
})
