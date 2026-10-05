import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { factsOf } from '#auth/activity'
import { hashSessionId } from '#auth/session'
import type { StaffMember } from '#auth/staff'
import { addressHash, suppressAll } from '#db/scoped/emailSuppression'
import { pgArray, withSystemScope } from '#db/scoped/index'
import { insertPasswordResets, selectResetByToken } from '#db/scoped/partnerInvitations'
import { selectStaffInvitationByToken } from '#db/scoped/staffMembers'
import { handleSesHook } from '#hooks/ses'
import { SesUnavailable, type OutgoingEmail, type SesApi, type SnsMessage, type SnsVerifier } from '#integrations/ses/index'
import { emailDeliverer } from '#jobs/queues/deliverers/email'
import { defaultRelayOptions, relayDue } from '#jobs/queues/outbox-relay'
import { activityLog } from '#saas/activity/index'
import { queueSideEffect } from '#saas/outbox/index'
import { createStaffMembersService } from '#saas/staffMembers/index'
import { seed } from '../scripts/seed/seed'
import { createTestDatabase, type TestDatabase } from './support/database'

// Card #274: the outbox's email through SES, suppression and the SNS hook; #290: store invitations.

let db: TestDatabase
// The database's clock when the tests start, not a fixed date: the rows they read are stamped with its now().
let now: Date
const hosts = { adminHost: 'admin.dripfunnel.test', platformHost: 'platform.dripfunnel.test' }
const senderDomain = 'mail.dripfunnel.test'
const suppressionKey = btoa('k'.repeat(32))

/** SES stand-in: keeps what it was sent, and fails the next `failures` sends. */
const fakeSes = () => {
  const sent: OutgoingEmail[] = []
  let failures = 0
  const api: SesApi = {
    send: async (email) => {
      if (failures > 0) {
        failures -= 1
        throw new SesUnavailable('answered 503')
      }
      sent.push(email)
      return { messageId: `m-${sent.length}` }
    },
  }
  return { api, sent, failNext: (n: number) => (failures = n) }
}

const relay = (ses: SesApi, at = new Date(Date.now() + 1000)) =>
  relayDue(db.sql, { email: emailDeliverer(db.sql, ses, { hosts, senderDomain, suppressionKey, now: () => now }) }, { ...defaultRelayOptions, now: () => at, baseDelayMs: 0 })

const queue = (template: string, payload: Record<string, unknown>, ids: { partnerId: string | null; storeId: string | null }, key = crypto.randomUUID()) =>
  withSystemScope(db.sql, (tx) => queueSideEffect(tx, { kind: 'email', idempotencyKey: `${template}:${key}`, payload: { template, ...payload }, ...ids }))

const tokenIn = (email: OutgoingEmail | undefined) => decodeURIComponent(/token=([^\s"&<]+)/.exec(email?.text ?? '')?.[1] ?? '')

let northstar: { id: string; ownerEmail: string; financeEmail: string }
let store: { id: string; partnerId: string; name: string; ownerEmail: string }

beforeAll(async () => {
  db = await createTestDatabase()
  const [clock] = await db.sql<{ now: Date }[]>`select now() as now`
  if (!clock) throw new Error('the test database gave no clock')
  now = clock.now
  await seed(db.url, now)
  const [p] = await db.sql<{ id: string; owner: string; finance: string }[]>`
    select p.id,
      (select email from partner_user where partner_id = p.id and role_key = 'partner-owner' order by created_at limit 1) as owner,
      (select email from partner_user where partner_id = p.id and role_key = 'partner-finance' and status = 'active' order by created_at limit 1) as finance
    from partner p where p.name like 'Northstar%'
  `
  if (!p) throw new Error('seed: no Northstar')
  northstar = { id: p.id, ownerEmail: p.owner, financeEmail: p.finance }
  const [s] = await db.sql<{ id: string; partner_id: string; name: string; email: string }[]>`
    select s.id, s.partner_id, s.name, u.email from store s
    join membership m on m.store_id = s.id and m.role_key = 'owner' and m.seller_id is null
    join "user" u on u.id = m.user_id
    order by s.created_at limit 1
  `
  if (!s) throw new Error('seed: no store with an owner')
  store = { id: s.id, partnerId: s.partner_id, name: s.name, ownerEmail: s.email }
}, 120_000)

afterAll(async () => {
  await db?.drop()
})

describe('email delivery', () => {
  it('sends a staff invitation from DripFunnel with a link that opens the invitation, minting it again after a failed send', async () => {
    const [admin] = await db.sql<StaffMember[]>`select id, email, name, role_key as role from staff_user where role_key = 'staff-super-admin' and status = 'active' limit 1`
    if (!admin) throw new Error('seed: no super admin')
    const staff = createStaffMembersService({ sql: db.sql, staff: admin, facts: factsOf(new Request('https://admin.dripfunnel.test/api')), activity: activityLog, now: () => now })
    expect(await staff.inviteStaff('new.hire@dripfunnel.example', 'staff-support')).toMatchObject({ ok: true })

    const ses = fakeSes()
    ses.failNext(1)
    expect(await relay(ses.api)).toMatchObject({ retry: 1, delivered: 0 })
    expect(await relay(ses.api, new Date(Date.now() + 60_000))).toMatchObject({ delivered: 1 })
    expect(ses.sent).toHaveLength(1)
    const [mail] = ses.sent
    expect(mail).toMatchObject({ from: `"DripFunnel" <no-reply@${senderDomain}>`, to: ['new.hire@dripfunnel.example'] })
    expect(mail?.text).toContain(`https://${hosts.adminHost}/api/auth/accept-invitation?token=`)
    const invitation = await withSystemScope(db.sql, async (tx) => selectStaffInvitationByToken(tx, await hashSessionId(tokenIn(mail))))
    expect(invitation?.email).toBe('new.hire@dripfunnel.example')
    expect(await relay(ses.api, new Date(Date.now() + 120_000))).toMatchObject({ delivered: 0 })
    expect(ses.sent).toHaveLength(1)
  })

  it('links a partner reset to the reset page with a token that opens it', async () => {
    const [reset] = await withSystemScope(db.sql, (tx) => insertPasswordResets(tx, crypto.randomUUID(), northstar.ownerEmail))
    if (!reset) throw new Error('no reset')
    await queue('partner-password-reset', { partnerPasswordResetId: reset.id, to: reset.email }, { partnerId: reset.partner_id, storeId: null })
    const ses = fakeSes()
    await relay(ses.api)
    expect(ses.sent[0]?.text).toContain(`https://${hosts.platformHost}/reset-password?token=`)
    const open = await withSystemScope(db.sql, async (tx) => selectResetByToken(tx, await hashSessionId(tokenIn(ses.sent[0])), new Date()))
    expect(open?.id).toBe(reset.id)
  })

  it("writes to a store's Owners in its partner's look, from the partner's fallback sender, escaping what people typed", async () => {
    await queue('store-suspended', { storeId: store.id, reason: 'Unpaid <b>invoice</b> & more', contact: 'partner-support' }, { partnerId: store.partnerId, storeId: store.id })
    const ses = fakeSes()
    await relay(ses.api)
    const [mail] = ses.sent
    expect(mail?.to).toEqual([store.ownerEmail])
    expect(mail?.from).toMatch(new RegExp(`<no-reply@([a-z0-9-]+\\.)?${senderDomain.replace(/\./g, '\\.')}>$`))
    expect(mail?.from).not.toMatch(/^"DripFunnel"/)
    expect(mail?.subject).toBe(`${store.name} is suspended`)
    expect(mail?.html).toContain('Unpaid &lt;b&gt;invoice&lt;/b&gt; &amp; more')
    expect(mail?.html).not.toContain('<b>invoice</b>')
    expect(mail?.text).not.toMatch(/dripfunnel\.com/i)
  })

  it('tells Owner and Finance about a declined card', async () => {
    await queue('partner-card-declined', { invoiceId: 'in_test1' }, { partnerId: northstar.id, storeId: null })
    const ses = fakeSes()
    await relay(ses.api)
    expect([...(ses.sent[0]?.to ?? [])].sort()).toEqual([northstar.ownerEmail, northstar.financeEmail].sort())
  })

  it('renders and delivers every template it takes, once each', async () => {
    const [plan] = await db.sql<{ id: string }[]>`select id from plan where partner_id = ${store.partnerId} limit 1`
    const [domain] = await db.sql<{ id: string }[]>`select id from partner_domain where partner_id = ${northstar.id} limit 1`
    const [locked] = await db.sql<{ id: string; email: string }[]>`select id, email from partner_user where partner_id = ${northstar.id} and status = 'active' limit 1`
    if (!plan || !domain || !locked) throw new Error('seed: missing plan, domain or user')
    const changeAt = new Date('2026-11-05T00:00:00Z').toISOString()
    const storeIds = { partnerId: store.partnerId, storeId: store.id }
    await queue('partner-user-locked', { partnerUserId: locked.id, to: locked.email, minutes: 15 }, { partnerId: northstar.id, storeId: null })
    await queue('partner-domain-live', { partnerId: northstar.id, domainId: domain.id, kind: 'portal' }, { partnerId: northstar.id, storeId: null })
    await queue('partner-payout-account-failed', {}, { partnerId: northstar.id, storeId: null })
    await queue('plan-change-at-renewal', { storeId: store.id, planId: plan.id, version: 1, changeAt }, storeIds)
    await queue('plan-retired-move', { storeId: store.id, planId: plan.id, version: 1, changeAt }, storeIds)
    await queue('store-plan-changed', { storeId: store.id, planId: plan.id, when: 'next', contact: 'partner-support' }, storeIds)
    await queue('store-restored', { storeId: store.id, contact: 'partner-support' }, storeIds)
    const ses = fakeSes()
    expect(await relay(ses.api)).toMatchObject({ delivered: 7, retry: 0, dead: 0 })
    expect(ses.sent.map((m) => m.subject)).toEqual(
      expect.arrayContaining(['Your DripFunnel account is locked for now', 'Your payout account couldn’t be verified', `${store.name} is back`, `${store.name}’s plan has changed`]),
    )
    expect(ses.sent.find((m) => m.subject === `${store.name} is changing plan`)?.text).toContain('5 November 2026 (UTC)')
    expect(await relay(ses.api, new Date(Date.now() + 60_000))).toMatchObject({ delivered: 0 })
  })

  it('sends a store invitation in the partner’s voice to its portal host: set a password if new, sign in to join if not', async () => {
    const live = await db.sql<{ id: string; host: string }[]>`select id, host from partner_domain where partner_id = ${store.partnerId} and kind = 'portal' and status = 'live'`
    await db.sql`update partner_domain set status = 'verifying' where id = any(${pgArray(live.map((d) => d.id))}::uuid[])`
    const portal = live[0]?.host ?? 'store.invite-test.example'
    const invite = async (email: string, withPassword: boolean) => {
      await db.sql`insert into "user" (partner_id, email, name, status, password_hash) values (${store.partnerId}, ${email}, 'Invitee', ${withPassword ? 'active' : 'invited'}, ${withPassword ? 'pbkdf2-sha256$1$AA==$AA==' : null})`
      const [row] = await db.sql<{ id: string }[]>`insert into invitation (store_id, email, role_key, expires_at, invited_by_label) values (${store.id}, ${email}, 'manager', ${new Date(now.getTime() + 7 * 86_400_000)}, 'Priya Shah') returning id`
      await queue('store-owner-invitation', { invitationId: row?.id, to: email, storeId: store.id }, { partnerId: store.partnerId, storeId: store.id })
      return row?.id ?? ''
    }
    const newId = await invite('fresh.person@shop.example', false)
    const outboxRow = async () => (await db.sql<{ attempts: number; delivered_at: Date | null; failed_at: Date | null }[]>`select attempts, delivered_at, failed_at from outbox where payload->>'invitationId' = ${newId}`)[0]
    const ses = fakeSes()
    // No live portal host yet: it waits, however many sweeps pass, and is never given up.
    for (let i = 0; i < 10; i += 1) await relay(ses.api, new Date(Date.now() + i * 2 * 3_600_000))
    expect(await outboxRow()).toMatchObject({ attempts: 0, delivered_at: null, failed_at: null })
    expect(ses.sent.filter((m) => m.to.includes('fresh.person@shop.example'))).toEqual([])
    if (live.length) await db.sql`update partner_domain set status = 'live' where id = any(${pgArray(live.map((d) => d.id))}::uuid[])`
    else await db.sql`insert into partner_domain (partner_id, kind, host, status, record_type, expected) values (${store.partnerId}, 'portal', ${portal}, 'live', 'CNAME', 'x')`
    await relay(ses.api, new Date(Date.now() + 21 * 3_600_000))
    expect((await outboxRow())?.delivered_at).not.toBeNull()
    const fresh = ses.sent.find((m) => m.to.includes('fresh.person@shop.example'))
    expect(fresh?.to).toEqual(['fresh.person@shop.example'])
    expect(fresh?.subject).toBe(`You’re invited to ${store.name}`)
    expect(fresh?.text).toContain(`https://${portal}/accept-invite?token=`)
    expect(fresh?.text).toContain('Priya Shah invited you')
    expect(fresh?.text).not.toContain('DripFunnel partner console')
    const [stored] = await db.sql<{ token_hash: string }[]>`select token_hash from invitation where id = ${newId}`
    expect(stored?.token_hash).toBe(await hashSessionId(tokenIn(fresh)))
    await invite('known.person@shop.example', true)
    await relay(ses.api, new Date(Date.now() + 22 * 3_600_000))
    expect(ses.sent.find((m) => m.to.includes('known.person@shop.example'))?.text).toContain(`https://${portal}/join?token=`)
  })

  it('sends an email change’s link to the new address only, and a notice without one to the old', async () => {
    const [u] = await db.sql<{ id: string; email: string }[]>`select u.id, u.email from "user" u where u.partner_id = ${store.partnerId} and u.status = 'active' limit 1`
    const [c] = await db.sql<{ id: string }[]>`insert into user_email_change (partner_id, user_id, new_email, expires_at) values (${store.partnerId}, ${u?.id ?? ''}, 'moved@shop.example', ${new Date(now.getTime() + 86_400_000)}) returning id`
    for (const template of ['user-email-change', 'user-email-changing']) await queue(template, { emailChangeId: c?.id }, { partnerId: store.partnerId, storeId: null })
    const ses = fakeSes()
    await relay(ses.api, new Date(Date.now() + 23 * 3_600_000))
    const link = ses.sent.find((m) => m.to.includes('moved@shop.example'))
    const notice = ses.sent.find((m) => m.to.includes(u?.email ?? ''))
    expect(link?.text).toMatch(/https:\/\/[^/]+\/confirm-email\?token=/)
    expect(notice?.text).not.toContain('token=')
    expect(notice?.subject).toContain('is about to change')
  })

  it('sends no invitation link once the invitation is revoked, and none filed under another partner', async () => {
    const [row] = await db.sql<{ id: string }[]>`insert into invitation (store_id, email, role_key, expires_at, invited_by_label, revoked_at) values (${store.id}, 'gone@shop.example', 'staff', ${new Date(now.getTime() + 86_400_000)}, 'Priya', ${now}) returning id`
    await queue('store-owner-invitation', { invitationId: row?.id, to: 'gone@shop.example', storeId: store.id }, { partnerId: store.partnerId, storeId: store.id })
    const [open] = await db.sql<{ id: string }[]>`insert into invitation (store_id, email, role_key, expires_at, invited_by_label) values (${store.id}, 'misfiled@shop.example', 'staff', ${new Date(now.getTime() + 86_400_000)}, 'Priya') returning id`
    await queue('store-owner-invitation', { invitationId: open?.id, to: 'misfiled@shop.example', storeId: store.id }, { partnerId: northstar.id === store.partnerId ? crypto.randomUUID() : northstar.id, storeId: store.id })
    const ses = fakeSes()
    await relay(ses.api, new Date(Date.now() + 180_000))
    expect(ses.sent.filter((m) => m.to.includes('gone@shop.example') || m.to.includes('misfiled@shop.example'))).toEqual([])
  })

  it("skips a suppressed address for a merchant notice, and keeps only a keyed hash of it", async () => {
    await withSystemScope(db.sql, (tx) => suppressAll(tx, suppressionKey, [store.ownerEmail.toUpperCase()], 'complaint', now))
    await queue('store-restored', { storeId: store.id, contact: 'partner-support' }, { partnerId: store.partnerId, storeId: store.id })
    const ses = fakeSes()
    expect(await relay(ses.api)).toMatchObject({ delivered: 1 })
    expect(ses.sent).toEqual([])
    const rows = await db.sql<{ address_hash: string }[]>`select address_hash from email_suppression`
    expect(JSON.stringify(rows)).not.toContain(store.ownerEmail)
    const plain = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(store.ownerEmail.toLowerCase()))
    const plainHex = [...new Uint8Array(plain)].map((b) => b.toString(16).padStart(2, '0')).join('')
    expect(rows.map((r) => r.address_hash)).not.toContain(plainHex)
  })

  it('still sends an invitation, reset or lock notice to a suppressed address', async () => {
    await withSystemScope(db.sql, (tx) => suppressAll(tx, suppressionKey, ['locked.out@example.com', 'LOCKED.OUT@example.com'], 'complaint', now))
    const [user] = await db.sql<{ id: string }[]>`select id from partner_user where partner_id = ${northstar.id} and status = 'active' limit 1`
    await queue('partner-user-locked', { partnerUserId: user?.id, to: 'locked.out@example.com', minutes: 15 }, { partnerId: northstar.id, storeId: null })
    const ses = fakeSes()
    await relay(ses.api)
    expect(ses.sent.map((m) => m.to)).toEqual([['locked.out@example.com']])
  })

  it('finds Owner and Finance however many users the partner has', async () => {
    await db.sql`
      insert into partner_user (partner_id, email, name, role_key, status, created_at)
      select ${northstar.id}, 'filler' || n || '@northstar.example', 'Filler ' || n, 'partner-support', 'active', now() - interval '10 years' + n * interval '1 minute'
      from generate_series(1, 120) n
    `
    await db.sql`insert into partner_user (partner_id, email, name, role_key, status) values (${northstar.id}, 'late.finance@northstar.example', 'Late Finance', 'partner-finance', 'active')`
    await queue('partner-payout-account-failed', {}, { partnerId: northstar.id, storeId: null })
    const ses = fakeSes()
    await relay(ses.api)
    expect(ses.sent[0]?.to).toEqual(expect.arrayContaining([northstar.ownerEmail, northstar.financeEmail, 'late.finance@northstar.example']))
    expect(ses.sent[0]?.to.some((a) => a.startsWith('filler'))).toBe(false)
  })

  it("tells only a store's live Owners: never a suspended, deleted or never-joined one", async () => {
    await db.sql`delete from email_suppression`
    const owner = async (email: string, user: string, membership: string) => {
      const [u] = await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${store.partnerId}, ${email}, 'Co-owner', ${user}) returning id`
      await db.sql`insert into membership (user_id, store_id, role_key, status) values (${u?.id ?? ''}, ${store.id}, 'owner', ${membership})`
    }
    await owner('suspended.owner@shop.example', 'active', 'suspended')
    await owner('deleted.owner@shop.example', 'deleted', 'active')
    await owner('invited.owner@shop.example', 'invited', 'invited')
    await queue('store-plan-changed', { storeId: store.id, planId: (await db.sql<{ id: string }[]>`select id from plan where partner_id = ${store.partnerId} limit 1`)[0]?.id, when: 'now', contact: 'partner-support' }, { partnerId: store.partnerId, storeId: store.id })
    const ses = fakeSes()
    await relay(ses.api)
    expect(ses.sent.map((m) => m.to)).toEqual([[store.ownerEmail]])
  })

  it('tells a live Owner about a live domain even when an earlier Owner was removed', async () => {
    const [domain] = await db.sql<{ id: string }[]>`select id from partner_domain where partner_id = ${northstar.id} limit 1`
    await db.sql`update partner_user set status = 'removed' where partner_id = ${northstar.id} and lower(email) = lower(${northstar.ownerEmail})`
    await db.sql`insert into partner_user (partner_id, email, name, role_key, status) values (${northstar.id}, 'second.owner@northstar.example', 'Second Owner', 'partner-owner', 'active')`
    await queue('partner-domain-live', { partnerId: northstar.id, domainId: domain?.id, kind: 'portal' }, { partnerId: northstar.id, storeId: null })
    const ses = fakeSes()
    await relay(ses.api)
    expect(ses.sent.map((m) => m.to)).toEqual([['second.owner@northstar.example']])
  })

  it('names at most 50 Owners on a store notice, the live ones first in line', async () => {
    await db.sql`delete from email_suppression`
    for (let n = 0; n < 60; n += 1) {
      const [u] = await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${store.partnerId}, ${`owner${n}@many.example`}, 'Owner', 'active') returning id`
      await db.sql`insert into membership (user_id, store_id, role_key, status) values (${u?.id ?? ''}, ${store.id}, 'owner', 'active')`
    }
    await queue('store-restored', { storeId: store.id, contact: 'partner-support' }, { partnerId: store.partnerId, storeId: store.id })
    const ses = fakeSes()
    await relay(ses.api)
    expect(ses.sent[0]?.to).toHaveLength(50)
    expect(ses.sent[0]?.to).toContain(store.ownerEmail)
  })

  it("sends nothing when the store or domain isn't the outbox row's partner's", async () => {
    const [other] = await db.sql<{ id: string }[]>`select id from partner where id <> ${store.partnerId} limit 1`
    const [domain] = await db.sql<{ id: string }[]>`select id from partner_domain where partner_id = ${northstar.id} limit 1`
    if (!other || !domain) throw new Error('seed: need two partners and a domain')
    await queue('store-restored', { storeId: store.id, contact: 'partner-support' }, { partnerId: other.id, storeId: store.id })
    await queue('partner-domain-live', { partnerId: northstar.id, domainId: domain.id, kind: 'portal' }, { partnerId: other.id === northstar.id ? store.partnerId : other.id, storeId: null })
    const ses = fakeSes()
    expect(await relay(ses.api)).toMatchObject({ delivered: 2, retry: 0 })
    expect(ses.sent).toEqual([])
  })

  it("mints no link and sends nothing when an account email's record isn't the outbox row's partner's", async () => {
    const [other] = await db.sql<{ id: string }[]>`select id from partner where id <> ${northstar.id} limit 1`
    // An invitation a link could be minted for (sent, open, unexpired), so only the partner check stops it.
    const [invitee] = await db.sql<{ id: string }[]>`insert into partner_user (partner_id, email, name, role_key, status) values (${northstar.id}, 'invitee@northstar.example', 'Invitee', 'partner-support', 'invited') returning id`
    const [invitation] = await db.sql<{ id: string; partner_id: string }[]>`
      insert into partner_invitation (partner_id, partner_user_id, expires_at, sent_at, invited_by_kind, invited_by_label)
      values (${northstar.id}, ${invitee?.id ?? ''}, ${new Date(now.getTime() + 7 * 86_400_000)}, ${now}, 'staff', 'DripFunnel') returning id, partner_id
    `
    const [user] = await db.sql<{ id: string }[]>`select id from partner_user where partner_id = ${northstar.id} limit 1`
    if (!other || !invitation || !user) throw new Error('seed: need two partners and a user')
    const wrong = other.id
    const [reset] = await withSystemScope(db.sql, (tx) => insertPasswordResets(tx, crypto.randomUUID(), northstar.financeEmail))
    const before = await db.sql<{ token_hash: string | null }[]>`select token_hash from partner_invitation where id = ${invitation.id}`
    await queue('partner-team-invitation', { partnerInvitationId: invitation.id, to: 'someone@else.example', partnerName: 'Theirs' }, { partnerId: wrong, storeId: null })
    await queue('partner-password-reset', { partnerPasswordResetId: reset?.id, to: 'someone@else.example' }, { partnerId: other.id, storeId: null })
    await queue('partner-user-locked', { partnerUserId: user.id, to: 'someone@else.example', minutes: 15 }, { partnerId: other.id, storeId: null })
    const [staffInvitation] = await db.sql<{ id: string }[]>`select id from staff_invitation where accepted_at is null and revoked_at is null and expires_at > ${now} order by created_at desc limit 1`
    await queue('staff-invitation', { staffInvitationId: staffInvitation?.id, to: 'someone@else.example' }, { partnerId: northstar.id, storeId: null })
    const ses = fakeSes()
    expect(await relay(ses.api)).toMatchObject({ delivered: 4, retry: 0 })
    expect(ses.sent).toEqual([])
    expect(await db.sql`select token_hash from partner_invitation where id = ${invitation.id}`).toEqual(before)
  })
})

describe('SES hook', () => {
  const topicArn = 'arn:aws:sns:eu-west-1:123456789012:ses-events'
  const accept: SnsVerifier = { verify: async () => true }
  const notification = (message: unknown, topic = topicArn): Partial<SnsMessage> => ({
    Type: 'Notification', MessageId: crypto.randomUUID(), TopicArn: topic, Message: JSON.stringify(message), Timestamp: now.toISOString(),
    SignatureVersion: '2', Signature: 'c2ln', SigningCertURL: 'https://sns.eu-west-1.amazonaws.com/cert.pem',
  })
  const post = (body: unknown, verifier = accept, fetchImpl?: typeof fetch) =>
    handleSesHook(new Request('https://hooks.dripfunnel.test/ses', { method: 'POST', body: JSON.stringify(body) }), { sql: db.sql, verifier, topicArn, suppressionKey, now: () => now, ...(fetchImpl ? { fetchImpl } : {}) })
  const suppressed = async (address: string) =>
    withSystemScope(db.sql, async (tx) => (await tx`select 1 from email_suppression where address_hash = ${await addressHash(suppressionKey, address)}`).length > 0)

  it('suppresses a permanent bounce and a complaint, not a transient bounce', async () => {
    const bounce = (type: string, address: string) => ({ eventType: 'Bounce', bounce: { bounceType: type, bouncedRecipients: [{ emailAddress: address }] } })
    expect((await post(notification(bounce('Permanent', 'hard@example.com')))).status).toBe(200)
    expect((await post(notification(bounce('Transient', 'soft@example.com')))).status).toBe(200)
    expect((await post(notification({ notificationType: 'Complaint', complaint: { complainedRecipients: [{ emailAddress: 'angry@example.com' }] } }))).status).toBe(200)
    expect(await suppressed('hard@example.com')).toBe(true)
    expect(await suppressed('soft@example.com')).toBe(false)
    expect(await suppressed('angry@example.com')).toBe(true)
  })

  it("refuses another topic before checking a signature, and a bad signature", async () => {
    let checked = 0
    const counting: SnsVerifier = { verify: async () => (checked += 1) > 99 }
    expect((await post(notification({ eventType: 'Complaint' }, 'arn:aws:sns:eu-west-1:999999999999:theirs'), counting)).status).toBe(400)
    expect(checked).toBe(0)
    expect((await post(notification({ eventType: 'Complaint', complaint: { complainedRecipients: [{ emailAddress: 'x@example.com' }] } }), counting)).status).toBe(400)
    expect(await suppressed('x@example.com')).toBe(false)
  })

  it('confirms its subscription only at an SNS address, and answers 503 when the certificate is out of reach', async () => {
    const fetched: string[] = []
    const fetchImpl = (async (input: RequestInfo | URL) => {
      fetched.push(String(input))
      return new Response('ok')
    }) as typeof fetch
    const confirmation = { ...notification({}), Type: 'SubscriptionConfirmation', Token: 't', SubscribeURL: 'https://sns.eu-west-1.amazonaws.com/?Action=ConfirmSubscription&Token=t' }
    expect((await post(confirmation, accept, fetchImpl)).status).toBe(200)
    expect((await post({ ...confirmation, SubscribeURL: 'https://evil.example/' }, accept, fetchImpl)).status).toBe(400)
    expect(fetched).toEqual([confirmation.SubscribeURL])
    const unreachable: SnsVerifier = { verify: async () => Promise.reject(new Error('certificate answered 500')) }
    expect((await post(notification({ eventType: 'Bounce' }), unreachable)).status).toBe(503)
  })
})
