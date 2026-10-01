import { ImpBanner, SessionControls, SessionNotice, sessionControls, type PortalStaffSession, type SessionBlock } from '@dripfunnel/shared/ui'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { adminConsoleUrl } from '../../api/staffSession'
import { fill, messages } from '../../messages'
import { copy } from './StaffSessionRoot'

const textOf = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&#x27;/g, '’').replace(/&amp;/g, '&')
const noop = () => undefined

const setup: PortalStaffSession = {
  id: 'su-1',
  kind: 'setup',
  state: 'open',
  endedBy: null,
  staffName: 'Maya Ortiz',
  actingAs: null,
  partnerName: 'Tallis Studio',
  host: 'platform.dripfunnel.com',
  expiresAt: '2026-10-01T11:00:00Z',
}
const impersonation: PortalStaffSession = { ...setup, id: 'imp-1', kind: 'impersonation', staffName: 'Neha Rao', actingAs: { name: 'Olivia Grant', role: 'Owner', where: 'Loom & Thread · Partner console' } }

const bar = (session: PortalStaffSession) =>
  textOf(renderToString(<ImpBanner {...copy.bar(session, 90 * 60)} host={session.host} endLabel={copy.end} onEnd={noop} back={{ label: copy.back, href: adminConsoleUrl }} />))

describe('the partner console’s staff-session bar', () => {
  it('names DripFunnel on a setup session, and Support on an impersonation', () => {
    expect(bar(setup)).toContain('Setup session for Tallis Studio · You’re in as Maya Ortiz (DripFunnel)')
    expect(bar(impersonation)).toContain('Support session by Neha Rao')
    expect(bar(impersonation)).not.toContain('DripFunnel')
  })

  it('tells the partner’s team that DripFunnel is setting up the console', () => {
    expect(textOf(renderToString(<SessionNotice text={copy.notice(setup, 90 * 60)} />))).toContain('DripFunnel is setting up your console: Maya, until')
  })
})

describe('what a setup session can’t change', () => {
  const items = sessionControls.map((control) => ({ control, label: messages.controls[control] }))
  const reason = (block: SessionBlock, current: PortalStaffSession) => fill(messages.blocked[block], { user: '', partner: current.partnerName })

  it('leaves the partner its payment method, payout details and ownership, and nothing else', () => {
    const html = renderToString(<SessionControls session={setup} items={items} reason={reason} />)
    expect(html.match(/disabled=""/g)).toHaveLength(3)
    expect(textOf(html)).toContain('Tallis Studio enters this itself.')
  })
})
