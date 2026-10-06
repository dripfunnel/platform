import { afterEach, describe, expect, it, vi } from 'vitest'
import { stubApi } from '../testing/apiStub'
import { loadPartner, loadPartners, runPartnerAction } from './partners'

const permission = (allowed: boolean, reason: string | null = null, failingChecks: string[] | null = null) => ({ allowed, reason, failingChecks })

const row = {
  id: 'p1',
  name: 'Kaufladen Digital',
  house: false,
  kind: null,
  region: 'DACH',
  state: 'awaiting',
  stores: 1,
  portalHost: { host: null, status: null },
  setup: { done: 8, total: 10 },
  owner: { name: 'Jonas', email: 'jonas@kaufladen.example', invitation: 'active', invitationSentAt: null },
  createdAt: '2026-09-08T00:00:00.000Z',
  submittedAt: '2026-09-26T00:00:00.000Z',
  checks: { portalHost: true, emailDomain: false, pricedPlan: true, legalPages: true },
  approval: { setUpBy: 'Priya Shah', rule: 'second', approvals: 0 },
}

const partner = {
  ...row,
  country: 'DE',
  contacts: [],
  history: [{ at: '2026-09-22T00:00:00.000Z', action: 'partner.sent_back', by: 'Maya Ortiz', note: 'Impressum missing' }],
  checklist: [{ item: 'payoutDetails', status: 'missing', detail: 'Add the bank account', by: null }],
  branding: { productName: null, primaryColor: null, accentColor: null, poweredBy: 'on' },
  domains: [{ id: 'd1', kind: 'email', host: 'mail.kaufladen.example', status: 'waiting', record: 'TXT', expected: 'v=spf1', found: null, checkedAt: null }],
  plans: [{ id: 'pl1', name: 'Basis', status: 'live', maxProducts: 500, maxStaff: 2, stores: 1 }],
  team: [{ id: 'u1', name: 'Jonas', email: 'jonas@kaufladen.example', role: 'partner-owner', status: 'active', lastSignInAt: null }],
  actions: {
    approve: permission(false, 'GO_LIVE_CHECKS_FAILING', ['emailDomain']),
    sendBack: permission(true),
    pause: null,
    resume: null,
    setupSession: permission(true),
    sendInvite: null,
    resendInvite: null,
  },
}

afterEach(() => void vi.unstubAllGlobals())

describe('loadPartners', () => {
  it('sends the URL filter as the API filter, state for status, and reads the page without a total', async () => {
    const stub = stubApi({ data: { partners: { items: [row], pageInfo: { startCursor: null, endCursor: null, hasPreviousPage: false, hasNextPage: false }, create: permission(false, 'PARTNER_ADMINS_ONLY') } } })
    const page = await loadPartners({ status: 'awaiting', sort: 'oldestSubmitted' }, {})
    expect(stub.calls[0]?.variables).toEqual({ filter: { state: 'awaiting', setup: undefined, q: undefined, sort: 'oldestSubmitted' }, after: undefined, before: undefined })
    expect(page.items[0]?.portalHost).toEqual({ host: null, status: 'notSet' })
    expect(page.create).toEqual({ allowed: false, reason: 'PARTNER_ADMINS_ONLY' })
    expect(page).not.toHaveProperty('total')
  })
})

describe('loadPartner', () => {
  it('keeps the failing checks with the refusal and maps the team roles', async () => {
    stubApi({ data: { partner } })
    const loaded = await loadPartner('p1')
    expect(loaded?.actions).toEqual({
      approve: { allowed: false, reason: 'GO_LIVE_CHECKS_FAILING', failingChecks: ['emailDomain'] },
      sendBack: { allowed: true },
      setupSession: { allowed: true },
    })
    expect(loaded?.team[0]?.role).toBe('owner')
    expect(loaded?.impersonate).toEqual({})
    expect(loaded?.checklist[0]).toEqual({ item: 'payoutDetails', status: 'missing', detail: 'Add the bank account', by: null })
  })

  it('passes a refusal through with its code, so the route can show the denied view', async () => {
    stubApi({ errors: [{ message: 'Not allowed.', extensions: { code: 'FORBIDDEN' } }] })
    await expect(loadPartner('p1')).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})

describe('runPartnerAction', () => {
  it('calls the mutation of the action with the reason and throws the API code when refused', async () => {
    const ok = stubApi({ data: { pausePartner: { ok: true, code: null } } })
    await runPartnerAction('p1', 'pause', 'Contract ended')
    expect(ok.calls[0]?.query).toContain('pausePartner(id: $id, reason: $reason)')
    expect(ok.calls[0]?.variables).toEqual({ id: 'p1', reason: 'Contract ended' })
    stubApi({ data: { approvePartner: { ok: false, code: 'SET_UP_BY_CALLER' } } })
    await expect(runPartnerAction('p1', 'approve', 'KYC passed')).rejects.toMatchObject({ code: 'SET_UP_BY_CALLER' })
  })
})
