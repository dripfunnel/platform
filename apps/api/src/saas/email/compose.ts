import { z } from 'zod'
import { mintInvitationToken, mintResetToken } from '#auth/partnerTokens'
import { mintStaffInvitationToken } from '#auth/staffTokens'
import { mintEmailChangeToken } from '#auth/emailChangeTokens'
import { mintSignupEmailCode } from '#auth/signupCodes'
import { hashShopperCode } from '#auth/shopperAuth'
import { newSmsCode, smsCodeMs } from '#auth/storeCodes'
import { selectCodeForEmail, setCodeHash } from '#db/scoped/shopper'
import { mintStoreInvitationToken, mintUserResetToken } from '#auth/storeTokens'
import { selectBranding } from '#db/scoped/branding'
import type { ScopedSql } from '#db/scoped/index'
import { selectOrderEmail, selectShipmentToTell, type OrderEmailRow } from '#db/scoped/orderUpdates'
import { selectBillingAccount } from '#db/scoped/partnerBilling'
import { selectCataloguePlan } from '#db/scoped/partnerPlans'
import { selectActivePartnerEmails, selectInvitedPartnerRole, selectLivePortalHost, selectPartner, selectPartnerDomainById, selectPartnerHosts, selectRecordPartner } from '#db/scoped/partners'
import { selectActiveStoreOwnerEmails, selectStore } from '#db/scoped/stores'
import { selectSupportEmail } from '#db/scoped/storeSupport'
import { selectEmailChangeForEmail } from '#db/scoped/profile'
import { selectSignupForEmail } from '#db/scoped/signup'
import { selectStoreInvitationForEmail, selectUserResetPartner } from '#db/scoped/userInvitations'
import { selectUserPartner } from '#db/scoped/userSignIn'
import { senderLabel } from '#saas/domains/index'
import { NotYet } from '#saas/outbox/index'
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
  | { send: false; reason: 'link_closed' | 'no_recipient' | 'tenant_mismatch' }

/** A merchant's link needs the partner's portal host: until one is live the email waits, checked hourly, never given up. */
export class NoPortalHost extends NotYet {
  constructor() {
    super('no_portal_host', 60 * 60 * 1000)
  }
}

// The DripFunnel look, from the style guide's tokens (apps/ui/shared/ui/tokens.css).
const dripfunnel: Brand = { name: 'DripFunnel', primary: '#0a2a4a', accent: '#ec844f', supportEmail: null, supportUrl: null, poweredBy: false }

const id = z.uuid()
const email = z.string().max(320)
const payloads = {
  'staff-invitation': z.object({ staffInvitationId: id, to: email }),
  'partner-owner-invitation': z.object({ partnerInvitationId: id, to: email, partnerName: z.string().max(200) }),
  'partner-team-invitation': z.object({ partnerInvitationId: id, to: email, partnerName: z.string().max(200) }),
  'partner-password-reset': z.object({ partnerPasswordResetId: id, to: email }),
  'store-owner-invitation': z.object({ invitationId: id, to: email, storeId: id }),
  'user-password-reset': z.object({ userPasswordResetId: id, to: email }),
  'partner-user-locked': z.object({ partnerUserId: id, to: email, minutes: z.number().int().positive() }),
  'user-locked': z.object({ userId: id, to: email, minutes: z.number().int().positive() }),
  'user-email-change': z.object({ emailChangeId: id }),
  'signup-code': z.object({ signupId: id }),
  'shopper-code': z.object({ customerCodeId: id }),
  'user-email-changing': z.object({ emailChangeId: id }),
  'partner-domain-live': z.object({ partnerId: id, domainId: id, kind: z.enum(['portal', 'preview', 'shops', 'email']) }),
  'partner-card-declined': z.object({ invoiceId: z.string().max(255) }),
  'partner-payout-account-failed': z.object({}),
  'plan-change-at-renewal': z.object({ storeId: id, planId: id, changeAt: z.iso.datetime() }),
  'plan-retired-move': z.object({ storeId: id, planId: id, changeAt: z.iso.datetime() }),
  'store-plan-changed': z.object({ storeId: id, planId: id, when: z.enum(['next', 'now']) }),
  'store-suspended': z.object({ storeId: id, reason: z.string().max(500) }),
  'store-restored': z.object({ storeId: id }),
  'support-session-started': z.object({ supportSessionId: id }),
  'support-write-allowed': z.object({ supportSessionId: id }),
  'order-confirmed': z.object({ orderId: id }),
  'order-shipped': z.object({ orderId: id, fulfilmentId: id }),
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
export const prepareEmail = async (tx: ScopedSql, row: { payload: unknown; partnerId: string | null; storeId?: string | null }, hosts: EmailHosts, now: Date): Promise<Prepared> => {
  const { payload } = row
  const template = templateOf.parse(payload).template
  if (!(template in payloads)) throw new Error(`email: unknown template ${template}`)
  const t = template as Template
  const parse = <K extends Template>(k: K) => payloads[k].parse(payload) as z.infer<(typeof payloads)[K]>

  switch (t) {
    case 'staff-invitation': {
      const p = parse(t)
      // Staff email is DripFunnel's own: a row filed under any partner is not one.
      if (row.partnerId !== null) return { send: false, reason: 'tenant_mismatch' }
      const token = await mintStaffInvitationToken(tx, p.staffInvitationId, now)
      if (!token) return { send: false, reason: 'link_closed' }
      const w = en.staffInvitation
      return fromDripfunnel([p.to], { subject: w.subject, heading: w.heading, paragraphs: [w.body], action: { label: w.action, url: link(hosts.adminHost, '/api/auth/accept-invitation', token) }, note: en.linkOnce }, true)
    }
    case 'partner-owner-invitation':
    case 'partner-team-invitation': {
      const p = parse(t)
      if ((await selectRecordPartner(tx, 'invitation', p.partnerInvitationId)) !== row.partnerId) return { send: false, reason: 'tenant_mismatch' }
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
      if ((await selectRecordPartner(tx, 'reset', p.partnerPasswordResetId)) !== row.partnerId) return { send: false, reason: 'tenant_mismatch' }
      const token = await mintResetToken(tx, p.partnerPasswordResetId, now)
      if (!token) return { send: false, reason: 'link_closed' }
      const w = en.partnerPasswordReset
      return fromDripfunnel([p.to], { subject: w.subject, heading: w.heading, paragraphs: [w.body], action: { label: w.action, url: link(hosts.platformHost, '/reset-password', token) }, note: w.note }, true)
    }
    case 'store-owner-invitation': {
      const p = parse(t)
      const invitation = await selectStoreInvitationForEmail(tx, p.invitationId)
      if (!invitation) return { send: false, reason: 'link_closed' }
      if (invitation.partner_id !== row.partnerId) return { send: false, reason: 'tenant_mismatch' }
      const look = await partnerBrand(tx, invitation.partner_id)
      const host = await selectLivePortalHost(tx, invitation.partner_id)
      if (!look) return { send: false, reason: 'no_recipient' }
      if (!host) throw new NoPortalHost()
      const token = await mintStoreInvitationToken(tx, p.invitationId, now)
      if (!token) return { send: false, reason: 'link_closed' }
      const w = en.storeInvitation
      const role = invitation.seller_name ? w.roles.supplier(invitation.seller_name) : (w.roles[invitation.role_key as 'owner' | 'manager' | 'staff'] ?? w.roles.staff)
      const content: EmailContent = invitation.has_password
        ? { subject: w.subject(invitation.store_name), heading: w.heading(invitation.store_name), paragraphs: [w.existingPerson(invitation.invited_by_label, invitation.store_name, role)], action: { label: w.actionJoin, url: link(host, '/join', token) }, note: w.note }
        : { subject: w.subject(invitation.store_name), heading: w.heading(invitation.store_name), paragraphs: [w.newPerson(invitation.invited_by_label, invitation.store_name, role)], action: { label: w.actionNew, url: link(host, '/accept-invite', token) }, note: w.note }
      return { send: true, accountSecurity: true, to: [p.to], voice: look.voice, brand: look.brand, content }
    }
    case 'user-password-reset': {
      const p = parse(t)
      const partnerId = await selectUserResetPartner(tx, p.userPasswordResetId)
      if (!partnerId) return { send: false, reason: 'link_closed' }
      if (partnerId !== row.partnerId) return { send: false, reason: 'tenant_mismatch' }
      const look = await partnerBrand(tx, partnerId)
      const host = await selectLivePortalHost(tx, partnerId)
      if (!look) return { send: false, reason: 'no_recipient' }
      if (!host) throw new NoPortalHost()
      const token = await mintUserResetToken(tx, p.userPasswordResetId, now)
      if (!token) return { send: false, reason: 'link_closed' }
      const w = en.userPasswordReset
      return {
        send: true,
        accountSecurity: true,
        to: [p.to],
        voice: look.voice,
        brand: look.brand,
        content: { subject: w.subject(look.brand.name), heading: w.heading, paragraphs: [w.body(look.brand.name)], action: { label: w.action, url: link(host, '/reset-password', token) }, note: w.note },
      }
    }
    case 'partner-user-locked': {
      const p = parse(t)
      if ((await selectRecordPartner(tx, 'user', p.partnerUserId)) !== row.partnerId) return { send: false, reason: 'tenant_mismatch' }
      const w = en.partnerUserLocked
      return fromDripfunnel([p.to], { subject: w.subject, heading: w.heading, paragraphs: [w.body(p.minutes), w.notYou] }, true)
    }
    case 'signup-code': {
      const p = parse(t)
      const signup = await selectSignupForEmail(tx, p.signupId)
      if (!signup || signup.stage !== 'email') return { send: false, reason: 'link_closed' }
      if (signup.partner_id !== row.partnerId) return { send: false, reason: 'tenant_mismatch' }
      const look = await partnerBrand(tx, signup.partner_id)
      if (!look) return { send: false, reason: 'no_recipient' }
      const brand = look.brand.name
      // A code is made either way, so the next step answers alike; only the mailbox learns of the account (ACCESS.md §2).
      const code = await mintSignupEmailCode(tx, p.signupId, now)
      if (!code) return { send: false, reason: 'link_closed' }
      if (signup.has_account) {
        const host = await selectLivePortalHost(tx, signup.partner_id)
        if (!host) throw new NoPortalHost()
        const w = en.signupHasAccount
        return { send: true, accountSecurity: true, to: [signup.email], voice: look.voice, brand: look.brand, content: { subject: w.subject(brand), heading: w.heading, paragraphs: [w.body(brand)], action: { label: w.action, url: `https://${host}/sign-in` }, note: w.note } }
      }
      const w = en.signupCode
      return { send: true, accountSecurity: true, to: [signup.email], voice: look.voice, brand: look.brand, content: { subject: w.subject(brand), heading: w.heading, paragraphs: [w.body(code)], note: w.note } }
    }
    case 'shopper-code': {
      const p = parse(t)
      const found = await selectCodeForEmail(tx, p.customerCodeId, now)
      if (!found) return { send: false, reason: 'link_closed' }
      if (found.partner_id !== row.partnerId) return { send: false, reason: 'tenant_mismatch' }
      const look = await partnerBrand(tx, found.partner_id)
      if (!look) return { send: false, reason: 'no_recipient' }
      // Made as it is sent, so the code never rests in the outbox (ACCESS.md §6.1); the same email whether or not there's an account.
      const code = newSmsCode()
      if (!(await setCodeHash(tx, found.id, await hashShopperCode(found.id, code), new Date(now.getTime() + smsCodeMs), now))) return { send: false, reason: 'link_closed' }
      const w = en.shopperCode
      return { send: true, accountSecurity: true, to: [found.target], voice: look.voice, brand: look.brand, content: { subject: w.subject(found.store_name), heading: w.heading, paragraphs: [w.body(code)], note: w.note } }
    }
    case 'user-email-change':
    case 'user-email-changing': {
      const p = parse(t)
      const change = await selectEmailChangeForEmail(tx, p.emailChangeId)
      if (!change) return { send: false, reason: 'link_closed' }
      if (change.partner_id !== row.partnerId) return { send: false, reason: 'tenant_mismatch' }
      const look = await partnerBrand(tx, change.partner_id)
      if (!look) return { send: false, reason: 'no_recipient' }
      const brand = look.brand.name
      if (t === 'user-email-changing') {
        const w = en.userEmailChanging
        return { send: true, accountSecurity: true, to: [change.old_email], voice: look.voice, brand: look.brand, content: { subject: w.subject(brand), heading: w.heading, paragraphs: [w.body(brand), w.notYou] } }
      }
      const host = await selectLivePortalHost(tx, change.partner_id)
      if (!host) throw new NoPortalHost()
      const token = await mintEmailChangeToken(tx, p.emailChangeId, now)
      if (!token) return { send: false, reason: 'link_closed' }
      const w = en.userEmailChange
      return {
        send: true,
        accountSecurity: true,
        to: [change.new_email],
        voice: look.voice,
        brand: look.brand,
        content: { subject: w.subject(brand), heading: w.heading, paragraphs: [w.body(brand)], action: { label: w.action, url: link(host, '/confirm-email', token) }, note: w.note },
      }
    }
    case 'user-locked': {
      const p = parse(t)
      const partnerId = await selectUserPartner(tx, p.userId)
      if (!partnerId) return { send: false, reason: 'no_recipient' }
      if (partnerId !== row.partnerId) return { send: false, reason: 'tenant_mismatch' }
      const look = await partnerBrand(tx, partnerId)
      if (!look) return { send: false, reason: 'no_recipient' }
      const w = en.userLocked
      return { send: true, accountSecurity: true, to: [p.to], voice: look.voice, brand: look.brand, content: { subject: w.subject(look.brand.name), heading: w.heading, paragraphs: [w.body(p.minutes), w.notYou] } }
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
    case 'support-session-started':
    case 'support-write-allowed': {
      const p = parse(t)
      const session = await selectSupportEmail(tx, p.supportSessionId)
      if (!session) return { send: false, reason: 'link_closed' }
      if (session.partner_id !== row.partnerId || session.store_id !== row.storeId) return { send: false, reason: 'tenant_mismatch' }
      const m = await merchant(tx, session.store_id, row.partnerId)
      if (m === 'mismatch') return { send: false, reason: 'tenant_mismatch' }
      if (!m || m.to.length === 0) return { send: false, reason: 'no_recipient' }
      if (t === 'support-session-started') {
        const w = en.supportStarted
        const paragraphs = [w.body(session.agent_name, session.partner_name, m.store.name, session.user_name), w.reason(session.reason), ...(session.ticket ? [w.ticket(session.ticket)] : []), w.control]
        return { send: true, accountSecurity: false, to: m.to, voice: m.voice, brand: m.brand, content: { subject: w.subject(session.partner_name, m.store.name), heading: w.heading, paragraphs } }
      }
      const w = en.supportWriteAllowed
      const paragraphs = [w.body(session.decided_by_name ?? m.store.name, session.agent_name, session.partner_name, m.store.name), w.control]
      return { send: true, accountSecurity: false, to: m.to, voice: m.voice, brand: m.brand, content: { subject: w.subject(m.store.name), heading: w.heading, paragraphs } }
    }
    case 'order-confirmed':
    case 'order-shipped': {
      const p = parse(t)
      const fulfilmentId = 'fulfilmentId' in p ? p.fulfilmentId : null
      const o = await selectOrderEmail(tx, p.orderId, fulfilmentId)
      if (!o || o.state === 'cancelled' || o.lines.length === 0) return { send: false, reason: 'link_closed' }
      // The row's own store too: a forged row for another store of the same partner sends nothing.
      if (o.partner_id !== row.partnerId || o.store_id !== row.storeId) return { send: false, reason: 'tenant_mismatch' }
      if (!o.email) return { send: false, reason: 'no_recipient' }
      const look = await partnerBrand(tx, o.partner_id)
      if (!look) return { send: false, reason: 'no_recipient' }
      // A shopper hears from the store, in its partner's look: the store's name and its own contact (SAAS §3.6).
      const brand: Brand = { ...look.brand, name: o.store_name, supportEmail: o.contact_email, supportUrl: null }
      const item = (l: OrderEmailRow['lines'][number]) => (l.version_name ? `${l.name}, ${l.version_name}` : l.name)
      if (t === 'order-confirmed') {
        const w = en.orderConfirmed
        const money = (amount: string) => en.money(o.locale, amount, o.currency)
        const paragraphs = [
          w.intro(o.number),
          ...o.lines.map((l) => w.line(l.quantity, item(l), money(l.amount))),
          w.total(money(o.total_amount)),
          ...(o.payment_method === 'cod' ? [w.cod(money(o.total_amount))] : o.payment_method === 'bank_transfer' ? [w.transfer] : []),
          ...(o.ship_to ? [w.shipTo(o.ship_to.name, o.ship_to.city)] : []),
        ]
        return { send: true, accountSecurity: false, to: [o.email], voice: look.voice, brand, content: { subject: w.subject(o.store_name, o.number), heading: w.heading, paragraphs } }
      }
      const shipment = fulfilmentId ? await selectShipmentToTell(tx, fulfilmentId) : null
      if (!shipment || shipment.order_id !== p.orderId) return { send: false, reason: 'tenant_mismatch' }
      const w = en.orderShipped
      const tracking = shipment.tracking_number ? [shipment.courier_name ? w.courier(shipment.courier_name, shipment.tracking_number) : w.tracking(shipment.tracking_number)] : []
      const content: EmailContent = {
        subject: w.subject(o.store_name, o.number),
        heading: w.heading,
        paragraphs: [w.intro(o.number), ...o.lines.map((l) => w.line(l.quantity, item(l))), ...tracking],
        ...(shipment.tracking_url ? { action: { label: w.action, url: shipment.tracking_url } } : {}),
      }
      return { send: true, accountSecurity: false, to: [o.email], voice: look.voice, brand, content }
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
