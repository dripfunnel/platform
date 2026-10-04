import { z } from 'zod'
import { mintInvitationToken, mintResetToken } from '#auth/partnerTokens'
import { mintStaffInvitationToken } from '#auth/staffTokens'
import { selectBranding } from '#db/scoped/branding'
import type { ScopedSql } from '#db/scoped/index'
import { selectBillingAccount } from '#db/scoped/partnerBilling'
import { selectCataloguePlan } from '#db/scoped/partnerPlans'
import { selectActivePartnerEmails, selectInvitedPartnerRole, selectPartner, selectPartnerDomainById, selectPartnerHosts } from '#db/scoped/partners'
import { selectActiveStoreOwnerEmails, selectStore } from '#db/scoped/stores'
import { senderLabel } from '#saas/domains/index'
import { en } from './messages'
import type { Brand, EmailContent } from './render'

/** Hosts the links lead to, from the Worker's configuration. */
export interface EmailHosts {
  adminHost: string
  platformHost: string
}

/** Who the email speaks for: DripFunnel to its partners and staff, a partner to its merchants (SAAS §3.6). */
export type Voice = { kind: 'dripfunnel' } | { kind: 'partner'; label: string | null }

export type Prepared =
  /** `accountSecurity`: an invitation, reset or lock notice, which is sent even to a suppressed address. */
  | { send: true; to: string[]; voice: Voice; brand: Brand; content: EmailContent; accountSecurity: boolean }
  /** Nothing to send: the link is no longer open, or nobody is left to tell. A code, never a name. */
  | { send: false; reason: 'link_closed' | 'no_recipient' | 'held' | 'tenant_mismatch' }

/** Waits in the outbox until merchant sign-in can accept it (the Store card that follows #274). */
export const heldTemplates = ['store-owner-invitation'] as const

// The DripFunnel look, from the style guide's tokens (apps/ui/shared/ui/tokens.css).
const dripfunnel: Brand = { name: 'DripFunnel', primary: '#0a2a4a', accent: '#ec844f', supportEmail: null, supportUrl: null, poweredBy: false }

const id = z.uuid()
const email = z.string().max(320)
const payloads = {
  'staff-invitation': z.object({ staffInvitationId: id, to: email }),
  'partner-owner-invitation': z.object({ partnerInvitationId: id, to: email, partnerName: z.string().max(200) }),
  'partner-team-invitation': z.object({ partnerInvitationId: id, to: email, partnerName: z.string().max(200) }),
  'partner-password-reset': z.object({ partnerPasswordResetId: id, to: email }),
  'partner-user-locked': z.object({ partnerUserId: id, to: email, minutes: z.number().int().positive() }),
  'partner-domain-live': z.object({ partnerId: id, domainId: id, kind: z.enum(['portal', 'preview', 'shops', 'email']) }),
  'partner-card-declined': z.object({ invoiceId: z.string().max(255) }),
  'partner-payout-account-failed': z.object({}),
  'plan-change-at-renewal': z.object({ storeId: id, planId: id, changeAt: z.iso.datetime() }),
  'plan-retired-move': z.object({ storeId: id, planId: id, changeAt: z.iso.datetime() }),
  'store-plan-changed': z.object({ storeId: id, planId: id, when: z.enum(['next', 'now']) }),
  'store-suspended': z.object({ storeId: id, reason: z.string().max(500) }),
  'store-restored': z.object({ storeId: id }),
} as const
export type Template = keyof typeof payloads

const templateOf = z.object({ template: z.string() }).loose()

const link = (host: string, path: string, token: string) => `https://${host}${path}?token=${encodeURIComponent(token)}`

// SES takes 50 recipients a message (integrations/ses).
const maxRecipients = 50

// Every active Owner: a removed or invited first Owner never hides a live one.
const owner = (tx: ScopedSql, partnerId: string) => selectActivePartnerEmails(tx, partnerId, ['partner-owner'], maxRecipients)

// Billing is the Owner's and Finance's to fix (billing.write).
const billingPeople = (tx: ScopedSql, partnerId: string) => selectActivePartnerEmails(tx, partnerId, ['partner-owner', 'partner-finance'], maxRecipients)

const partnerBrand = async (tx: ScopedSql, partnerId: string): Promise<{ brand: Brand; voice: Voice } | null> => {
  const partner = await selectPartner(tx, partnerId)
  if (!partner) return null
  const { live } = await selectBranding(tx, partnerId)
  const brand: Brand = {
    name: live?.product_name ?? partner.product_name ?? partner.name,
    primary: live?.primary_color ?? partner.primary_color ?? dripfunnel.primary,
    accent: live?.accent_color ?? partner.accent_color ?? dripfunnel.accent,
    supportEmail: live?.support_email ?? null,
    supportUrl: live?.support_url ?? null,
    poweredBy: partner.powered_by !== 'off',
  }
  return { brand, voice: { kind: 'partner', label: senderLabel(await selectPartnerHosts(tx, partnerId)) } }
}

// Owners whose membership and account are both live: never a suspended, deleted or never-joined one.
const storeOwners = (tx: ScopedSql, storeId: string) => selectActiveStoreOwnerEmails(tx, storeId, maxRecipients)

/**
 * The store, its Owners and its partner's look, for every email about a store. A store that isn't
 * the outbox row's partner's is refused, so one partner's data never reaches another's people.
 */
const merchant = async (tx: ScopedSql, storeId: string, partnerId: string | null) => {
  const store = await selectStore(tx, storeId)
  if (!store) return null
  if (store.partner_id !== partnerId) return 'mismatch' as const
  const look = await partnerBrand(tx, store.partner_id)
  if (!look) return null
  return { store, to: await storeOwners(tx, storeId), ...look }
}

const fromDripfunnel = (to: string[], content: EmailContent, accountSecurity = false): Prepared =>
  to.length === 0 ? { send: false, reason: 'no_recipient' } : { send: true, to, voice: { kind: 'dripfunnel' }, brand: dripfunnel, content, accountSecurity }

/** Billing's two notices name the card or account on file, read now rather than carried in the row. */
const billingEmail = async (tx: ScopedSql, template: 'partner-card-declined' | 'partner-payout-account-failed', partnerId: string): Promise<Prepared> => {
  const account = await selectBillingAccount(tx, partnerId)
  const to = await billingPeople(tx, partnerId)
  if (template === 'partner-card-declined') {
    const w = en.partnerCardDeclined
    const card = account?.card_brand && account.card_last4 ? w.card(account.card_brand, account.card_last4) : w.someCard
    return fromDripfunnel(to, { subject: w.subject, heading: w.heading, paragraphs: [w.body(card)] })
  }
  const w = en.partnerPayoutAccountFailed
  const where = account?.payout_bank && account.payout_last4 ? w.account(account.payout_bank, account.payout_last4) : w.someAccount
  return fromDripfunnel(to, { subject: w.subject, heading: w.heading, paragraphs: [w.body(where)] })
}

/**
 * The email an outbox row describes, with its one-time link minted now (ACCESS §6.1): run it in
 * the transaction that sends, so a failed send leaves no link behind.
 */
export const prepareEmail = async (tx: ScopedSql, row: { payload: unknown; partnerId: string | null }, hosts: EmailHosts, now: Date): Promise<Prepared> => {
  const { payload } = row
  const template = templateOf.parse(payload).template
  if ((heldTemplates as readonly string[]).includes(template)) return { send: false, reason: 'held' }
  if (!(template in payloads)) throw new Error(`email: unknown template ${template}`)
  const t = template as Template
  const parse = <K extends Template>(k: K) => payloads[k].parse(payload) as z.infer<(typeof payloads)[K]>

  switch (t) {
    case 'staff-invitation': {
      const p = parse(t)
      const token = await mintStaffInvitationToken(tx, p.staffInvitationId, now)
      if (!token) return { send: false, reason: 'link_closed' }
      const w = en.staffInvitation
      return fromDripfunnel([p.to], { subject: w.subject, heading: w.heading, paragraphs: [w.body], action: { label: w.action, url: link(hosts.adminHost, '/api/auth/accept-invitation', token) }, note: en.linkOnce }, true)
    }
    case 'partner-owner-invitation':
    case 'partner-team-invitation': {
      const p = parse(t)
      const token = await mintInvitationToken(tx, p.partnerInvitationId, now)
      if (!token) return { send: false, reason: 'link_closed' }
      const url = link(hosts.platformHost, '/accept-invite', token)
      if (t === 'partner-owner-invitation') {
        const w = en.partnerOwnerInvitation
        return fromDripfunnel([p.to], { subject: w.subject(p.partnerName), heading: w.heading(p.partnerName), paragraphs: [w.body(p.partnerName)], action: { label: w.action, url }, note: en.linkOnce }, true)
      }
      const role = await selectInvitedPartnerRole(tx, p.partnerInvitationId)
      const w = en.partnerTeamInvitation
      return fromDripfunnel([p.to], {
        subject: w.subject(p.partnerName),
        heading: w.heading(p.partnerName),
        paragraphs: [w.body(p.partnerName, role ? en.roles[role] : en.roles['partner-read-only'])],
        action: { label: w.action, url },
        note: en.linkOnce,
      }, true)
    }
    case 'partner-password-reset': {
      const p = parse(t)
      const token = await mintResetToken(tx, p.partnerPasswordResetId, now)
      if (!token) return { send: false, reason: 'link_closed' }
      const w = en.partnerPasswordReset
      return fromDripfunnel([p.to], { subject: w.subject, heading: w.heading, paragraphs: [w.body], action: { label: w.action, url: link(hosts.platformHost, '/reset-password', token) }, note: w.note }, true)
    }
    case 'partner-user-locked': {
      const p = parse(t)
      const w = en.partnerUserLocked
      return fromDripfunnel([p.to], { subject: w.subject, heading: w.heading, paragraphs: [w.body(p.minutes), w.notYou] }, true)
    }
    case 'partner-domain-live': {
      const p = parse(t)
      if (p.partnerId !== row.partnerId) return { send: false, reason: 'tenant_mismatch' }
      const domain = await selectPartnerDomainById(tx, p.domainId)
      if (!domain) return { send: false, reason: 'no_recipient' }
      if (domain.partner_id !== row.partnerId) return { send: false, reason: 'tenant_mismatch' }
      const w = en.partnerDomainLive
      return fromDripfunnel(await owner(tx, p.partnerId), { subject: w.subject(domain.host), heading: w.heading, paragraphs: [w.body(domain.host, w.kinds[p.kind])] })
    }
    case 'partner-card-declined':
    case 'partner-payout-account-failed': {
      parse(t)
      return row.partnerId ? billingEmail(tx, t, row.partnerId) : { send: false, reason: 'no_recipient' }
    }
    case 'plan-change-at-renewal':
    case 'plan-retired-move': {
      const p = parse(t)
      const m = await merchant(tx, p.storeId, row.partnerId)
      if (m === 'mismatch') return { send: false, reason: 'tenant_mismatch' }
      const plan = m && (await selectCataloguePlan(tx, m.store.partner_id, p.planId))
      if (!m || !plan || m.to.length === 0) return { send: false, reason: 'no_recipient' }
      const w = t === 'plan-change-at-renewal' ? en.planChangeAtRenewal : en.planRetiredMove
      const date = en.date(new Date(p.changeAt))
      return { send: true, accountSecurity: false, to: m.to, voice: m.voice, brand: m.brand, content: { subject: w.subject(m.store.name), heading: w.heading, paragraphs: [w.body(m.store.name, plan.name, date)] } }
    }
    case 'store-plan-changed': {
      const p = parse(t)
      const m = await merchant(tx, p.storeId, row.partnerId)
      if (m === 'mismatch') return { send: false, reason: 'tenant_mismatch' }
      const plan = m && (await selectCataloguePlan(tx, m.store.partner_id, p.planId))
      if (!m || !plan || m.to.length === 0) return { send: false, reason: 'no_recipient' }
      const w = en.storePlanChanged
      return { send: true, accountSecurity: false, to: m.to, voice: m.voice, brand: m.brand, content: { subject: w.subject(m.store.name), heading: w.heading, paragraphs: [w[p.when](m.store.name, plan.name)] } }
    }
    case 'store-suspended': {
      const p = parse(t)
      const m = await merchant(tx, p.storeId, row.partnerId)
      if (m === 'mismatch') return { send: false, reason: 'tenant_mismatch' }
      if (!m || m.to.length === 0) return { send: false, reason: 'no_recipient' }
      const w = en.storeSuspended
      // The partner's support, never DripFunnel's (SAAS §4.2): without one, no contact line.
      const contact = m.brand.supportEmail ?? m.brand.supportUrl
      const paragraphs = [w.body(m.store.name), w.reason(p.reason), ...(contact ? [w.contact(contact)] : [])]
      return { send: true, accountSecurity: false, to: m.to, voice: m.voice, brand: m.brand, content: { subject: w.subject(m.store.name), heading: w.heading, paragraphs } }
    }
    case 'store-restored': {
      const p = parse(t)
      const m = await merchant(tx, p.storeId, row.partnerId)
      if (m === 'mismatch') return { send: false, reason: 'tenant_mismatch' }
      if (!m || m.to.length === 0) return { send: false, reason: 'no_recipient' }
      const w = en.storeRestored
      return { send: true, accountSecurity: false, to: m.to, voice: m.voice, brand: m.brand, content: { subject: w.subject(m.store.name), heading: w.heading, paragraphs: [w.body(m.store.name)] } }
    }
  }
}
