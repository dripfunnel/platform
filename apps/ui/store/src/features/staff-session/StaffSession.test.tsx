import { HandoffScreen, ImpBanner, SessionControls, SessionEndCard, SessionNotice, sessionControls, type PortalStaffSession } from '@dripfunnel/shared/ui'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { adminConsoleUrl, staffSession } from '../../api/staffSession'
import { fill, messages } from '../../messages'
import { copy } from './StaffSessionRoot'

const words = messages.staffSession
const textOf = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&#x27;/g, '’').replace(/&amp;/g, '&')
const noop = () => undefined

const session: PortalStaffSession = {
  id: 'imp-1',
  kind: 'impersonation',
  state: 'open',
  endedBy: null,
  staffName: 'Neha Rao',
  actingAs: { name: 'Rohan Verma', role: 'Manager', where: 'Mehta Textiles' },
  partnerName: 'Bazaar Cloud',
  host: 'shop.bazaarcloud.in/mehta-textiles',
  expiresAt: '2026-10-01T09:30:00Z',
}

const banner = () =>
  renderToString(<ImpBanner {...copy.bar(session, 28 * 60)} host={session.host} endLabel={copy.end} onEnd={noop} back={{ label: copy.back, href: adminConsoleUrl }} />)

describe('the store’s staff-session bar', () => {
  it('says Support, never DripFunnel, and offers End and Back but no way to close it', () => {
    const html = banner()
    const text = textOf(html)
    expect(text).toContain('Impersonating Rohan Verma')
    expect(text).toContain('Support session by Neha Rao')
    expect(text).toContain(session.host)
    expect(text).not.toContain('DripFunnel')
    expect(html).toContain('role="status"')
    expect(html).toContain(`href="${adminConsoleUrl}"`)
    expect(html.match(/<button/g)).toHaveLength(1)
    expect(text.toLowerCase()).not.toContain('read-only')
  })

  it('tells everyone else signed in that Support is in', () => {
    const text = textOf(renderToString(<SessionNotice text={copy.notice(session, 28 * 60)} />))
    expect(text).toContain('Support (Neha) is signed in as Rohan.')
  })

  it('draws the three end states', () => {
    const card = (title: string, body: string) => textOf(renderToString(<SessionEndCard title={title} body={body} action={{ label: copy.action, href: adminConsoleUrl }} />))
    const ended = copy.over({ ...session, state: 'ended', endedBy: 'admin' })
    expect(card(ended.title, ended.body)).toContain(words.endedBody.admin)
    const expired = copy.over({ ...session, state: 'expired', endedBy: 'expiry' })
    expect(card(expired.title, expired.body)).toContain('Your time as Rohan is up')
    const invalid = textOf(renderToString(<HandoffScreen token={undefined} client={staffSession} words={words} adminUrl={adminConsoleUrl} replaceUrl={noop} />))
    expect(invalid).toContain(words.invalid.title)
  })

  it('never puts the handoff token in the page', () => {
    const token = 'fx.secret-token-value'
    const html = renderToString(<HandoffScreen token={token} client={staffSession} words={words} adminUrl={adminConsoleUrl} replaceUrl={noop} />)
    expect(textOf(html)).toContain(words.pending)
    expect(html).not.toContain(token)
  })
})

describe('what an impersonation can’t change', () => {
  const items = sessionControls.map((control) => ({ control, label: messages.controls[control] }))
  const reason = (block: 'BLOCKED_WHILE_IMPERSONATING' | 'PARTNER_ENTERS_THIS_ITSELF', current: PortalStaffSession) => fill(messages.blocked[block], { user: 'Rohan', partner: current.partnerName })

  it('disables each control with the reason beside it', () => {
    const html = renderToString(<SessionControls session={session} items={items} reason={reason} />)
    expect(html.match(/disabled=""/g)).toHaveLength(sessionControls.length)
    expect(textOf(html)).toContain('Support can’t change this while signed in as Rohan.')
  })

  it('leaves them alone when no staff session is open', () => {
    expect(renderToString(<SessionControls session={null} items={items} reason={reason} />)).not.toContain('disabled')
  })
})
