import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { messages } from '../../messages'
import { CompanyTab } from './CompanyTab'
import { PayoutTab } from './PayoutTab'
import { SecurityTab } from './SecurityTab'
import { company, team } from './settingsTestData'
import { actionOnConfirm, dialogFor, TeamTab } from './TeamTab'
import { inviteFrom, isLastOwner, removeRefusal, roleRefusal, rolesFor, transferCandidates } from './teamRules'
import { partnerRoles } from '../shell/partnerRoles'

const words = messages.settings
const noop = () => undefined
const textOf = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, '’').replace(/&amp;/g, '&').replace(/\s+/g, ' ')
const render = async (element: ReactNode) => {
  const router = createRouter({ routeTree: createRootRoute({ component: () => element }), history: createMemoryHistory({ initialEntries: ['/settings'] }) })
  await router.load()
  return renderToString(<RouterProvider router={router} />)
}
const byId = (id: string) => {
  const found = team.find((m) => m.id === id)
  if (!found) throw new Error(id)
  return found
}
const teamTab = (role: Parameters<typeof TeamTab>[0]['role'], readOnly = false, session: Parameters<typeof TeamTab>[0]['session'] = null, busy = false) =>
  render(<TeamTab team={team} role={role} session={session} readOnly={readOnly} busy={busy} more={{ show: false, busy: false, failed: false }} onRun={() => Promise.resolve(true)} onMore={noop} />)

describe('Company', () => {
  it('is read-only, with the contacts, the contract and the partner manager’s line', async () => {
    const text = textOf(await render(<CompanyTab company={company} />))
    expect(text).toContain('United States')
    expect(text).toContain('Maya Chen · maya@northstar.example')
    expect(text).toContain('Growth $18.00 / store / month')
    expect(text).toContain(words.company.contractNote)
    expect(text).toContain(words.company.poweredByKept)
    const firstYear = textOf(await render(<CompanyTab company={{ ...company, contract: company.contract && { ...company.contract, poweredByRemovable: true, poweredByNote: 'firstYear' } }} />))
    expect(firstYear).toContain(words.company.poweredByFirstYear)
    expect(textOf(await render(<CompanyTab company={{ ...company, contract: null, billingContact: null }} />))).toContain(words.company.noContract)
  })
})

describe('Team', () => {
  it('lists everyone with (you), the invitation state and 2-factor', async () => {
    const text = textOf(await teamTab('partner-owner'))
    expect(text).toContain('Maya Chen (you)')
    expect(text).toContain(words.team.invited)
    expect(text).toContain(words.team.off)
    expect(text).toContain(words.team.resend)
  })

  it('holds the last Owner, the caller’s own row and an Admin’s reach over Owners', () => {
    expect(isLastOwner(byId('u1'), team)).toBe(true)
    expect(roleRefusal(byId('u1'), team, 'partner-owner')).toBe(words.team.refused.selfRole)
    expect(removeRefusal(byId('u1'), team, 'partner-owner')).toBe(words.team.refused.self)
    expect(removeRefusal(byId('u2'), team, 'partner-admin')).toBeNull()
    expect(roleRefusal({ ...byId('u1'), you: false }, team, 'partner-admin')).toBe(words.team.refused.ownerRole)
    expect(roleRefusal({ ...byId('u1'), you: false }, team, 'partner-owner')).toBe(words.team.refused.lastOwner)
    expect(removeRefusal(byId('u3'), team, 'partner-support')).toBe(words.team.refused.manage)
    expect(rolesFor('partner-admin', partnerRoles)).not.toContain('partner-owner')
    expect(rolesFor('partner-owner', partnerRoles)).toContain('partner-owner')
    expect(transferCandidates(team).map((m) => m.id)).toEqual(['u2', 'u3'])
  })

  it('lets only Owners and Admins invite, and only the Owner transfer, each refusal with its reason', async () => {
    const owner = textOf(await teamTab('partner-owner'))
    expect(owner).not.toContain(words.team.refused.manage)
    expect(owner).not.toContain(words.team.refused.transfer)
    const admin = textOf(await teamTab('partner-admin'))
    expect(admin).toContain(words.team.refused.transfer)
    const support = textOf(await teamTab('partner-support'))
    expect(support).toContain(words.team.refused.manage)
    expect(support).not.toContain(words.team.resend)
    expect(textOf(await teamTab('partner-owner', true))).toContain(words.team.refused.manage)
  })

  it('shows a staff session up front that it never changes who is Owner', async () => {
    const setup = textOf(await teamTab('partner-owner', false, 'setup'))
    expect(setup).toContain(words.team.refusals.PARTNER_ENTERS_THIS_ITSELF)
    expect(textOf(await teamTab('partner-owner', false, 'impersonation'))).toContain(words.team.refusals.BLOCKED_WHILE_IMPERSONATING)
    expect(rolesFor('partner-owner', partnerRoles, 'setup')).not.toContain('partner-owner')
  })

  it('shows why a role can’t change beside it, and holds every control while a change runs', async () => {
    const html = await teamTab('partner-owner')
    expect(textOf(html)).toContain(words.team.refused.selfRole)
    expect(html).toMatch(/aria-describedby="role-why-u1"/)
    const busy = await teamTab('partner-owner', false, null, true)
    expect(busy.match(/<select[^>]*disabled=""/g)?.length).toBe(team.length)
  })

  it('words every refusal the API sends', () => {
    for (const text of Object.values(words.team.refusals)) expect(text).not.toMatch(/\{(?!email)/)
  })
})

describe('the team’s confirmations', () => {
  it('run what was confirmed, and for a transfer the member picked, never a stale or ineligible one', () => {
    const diego = byId('u2')
    expect(actionOnConfirm({ kind: 'remove', member: diego }, team, {})).toEqual({ kind: 'remove', member: diego })
    expect(actionOnConfirm({ kind: 'transferPick' }, team, { to: 'u2' })).toEqual({ kind: 'transfer', member: diego })
    expect(actionOnConfirm({ kind: 'transferPick' }, team, { to: 'u1' })).toBeNull()
    expect(actionOnConfirm({ kind: 'transferPick' }, team, { to: 'u4' })).toBeNull()
  })

  it('state each consequence, and ask for TRANSFER typed', () => {
    expect(dialogFor({ kind: 'remove', member: byId('u2') }, team)).toMatchObject({ consequence: 'Diego Alvarez is signed out now and can’t sign in again. What they did stays in the activity log.', danger: true })
    expect(dialogFor({ kind: 'role', member: byId('u3'), role: 'partner-finance' }, team).consequence).toContain('Jess Moreno becomes Finance')
    expect(dialogFor({ kind: 'transferPick' }, team).typeToConfirm?.expected).toBe('TRANSFER')
  })

  it('take an invitation only with a name and an email-shaped address', () => {
    expect(inviteFrom(' Sam ', ' sam@northstar.example ', 'partner-support')).toEqual({ name: 'Sam', email: 'sam@northstar.example', role: 'partner-support' })
    expect(inviteFrom('', 'sam@northstar.example', 'partner-support')).toBeNull()
    expect(inviteFrom('Sam', 'not-an-email', 'partner-support')).toBeNull()
  })
})

describe('Payout and payment', () => {
  it('says nothing is connected yet, and never offers a card number field', async () => {
    const html = await render(<PayoutTab setupSession={false} partner="Northstar Commerce" />)
    expect(textOf(html)).toContain(words.payout.notConnected)
    expect(textOf(html)).toContain(words.payout.slot)
    expect(html).not.toMatch(/<input/)
  })

  it('tells a staff setup session these stay with the partner', async () => {
    expect(textOf(await render(<PayoutTab setupSession partner="Northstar Commerce" />))).toContain('Payment method and payout details stay with Northstar Commerce. Northstar Commerce enters these itself.')
  })
})

describe('Security', () => {
  it('is the Owner’s switch, naming who has 2-factor off', async () => {
    const owner = await render(<SecurityTab required={false} team={team} complete blocked={null} isOwner busy={false} session={null} onChange={noop} />)
    expect(owner).toMatch(/<input[^>]*type="checkbox"(?![^>]*disabled)/)
    expect(textOf(owner)).toContain('2-factor is off for: Jess Moreno.')
    const admin = await render(<SecurityTab required team={team} complete blocked={null} isOwner={false} busy={false} session={null} onChange={noop} />)
    expect(admin).toMatch(/<input[^>]*disabled=""/)
    expect(textOf(admin)).toContain(words.security.ownerOnly)
    expect(textOf(admin)).toContain(words.security.turningOff)
  })

  it('never claims everyone has 2-factor while more of the team is still to load, and counts only active members', async () => {
    const partial = textOf(await render(<SecurityTab required={false} team={team.filter((m) => m.secondFactor)} complete={false} blocked={null} isOwner busy={false} session={null} onChange={noop} />))
    expect(partial).toContain(words.security.allOnPartial)
    const invitedOff = textOf(await render(<SecurityTab required={false} team={team} complete blocked={null} isOwner busy={false} session={null} onChange={noop} />))
    expect(invitedOff).not.toContain('Sam Lee')
  })

  it('holds the switch during an impersonation, with the reason', async () => {
    const html = await render(<SecurityTab required={false} team={team} complete blocked={words.team.refusals.BLOCKED_WHILE_IMPERSONATING} isOwner busy={false} session={null} onChange={noop} />)
    expect(html).toMatch(/<input[^>]*disabled=""/)
    expect(textOf(html)).toContain(words.team.refusals.BLOCKED_WHILE_IMPERSONATING)
  })
})
