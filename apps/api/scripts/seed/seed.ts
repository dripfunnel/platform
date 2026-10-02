import postgres from 'postgres'
import type { ActivityEntry } from '#auth/activity'
import type { ProvisioningStep, StoreStatus } from '#db/schema/saas'
import { insertActivity } from '#db/scoped/activity'
import type { ScopedSql } from '#db/scoped/index'
import {
  endSetupSession,
  insertPartner,
  insertPartnerInvitation,
  insertPartnerUser,
  insertPlan,
  insertSetupSession,
  updatePartnerState,
  upsertPartnerDomain,
  upsertSetupItem,
} from '#db/scoped/partners'
import { insertCustomDomain, insertJob, insertMembership, insertSeller, insertStore, insertStoreNote, insertUser, updateStoreStatus } from '#db/scoped/stores'
import { toRow } from '#saas/activity/log'
import { stepsFor } from '#saas/provisioning/stuck'
import { assertLoopbackOnly } from '../migrate/host-guard'
import { domainsFor, generated, generatedName, partners, recordFor, staff, stores, type SeedPartner, type SeedStore } from './data'

export interface SeedCounts {
  staff: number
  partners: number
  partnerUsers: number
  plans: number
  stores: number
  people: number
  jobs: number
  activity: number
}

// Everything the seed owns, in dependency order. A local developer's database only
// (AGENTS.md "Working with the user" rule 3), so wiping it is the point.
const owned = [
  'activity_log', 'outbox', 'store_note', 'job', 'invitation', 'membership', '"user"', 'custom_domain', 'store',
  'plan', 'partner_setup_item', 'partner_domain', 'partner_invitation', 'partner_user',
  'staff_partner_assignment', 'staff_session', 'staff_user', 'customer', 'seller', 'partner',
]

const daysAgo = (now: Date, days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
const minutesAgo = (now: Date, minutes: number) => new Date(now.getTime() - minutes * 60 * 1000)

/** Seeds the database at `connectionString`, which must be loopback: no CI opt-in, since this
 *  truncates. Returns what it wrote. */
export const seed = async (connectionString: string, now: Date = new Date()): Promise<SeedCounts> => {
  assertLoopbackOnly(connectionString)
  const sql = postgres(connectionString, { max: 1 })
  try {
    return await sql.begin(async (tx) => {
      await tx.unsafe(`truncate ${owned.join(', ')} restart identity cascade`)
      return seedInto(tx, now)
    })
  } finally {
    await sql.end()
  }
}

const seedInto = async (tx: ScopedSql, now: Date): Promise<SeedCounts> => {
  const counts: SeedCounts = { staff: 0, partners: 0, partnerUsers: 0, plans: 0, stores: 0, people: 0, jobs: 0, activity: 0 }
  const record = async (entry: ActivityEntry) => {
    await insertActivity(tx, toRow(entry))
    counts.activity += 1
  }

  const staffIds = new Map<string, string>()
  const staffByName = new Map<string, string>()
  for (const s of staff) {
    const [row] = await tx<{ id: string }[]>`
      insert into staff_user (sso_subject, email, name, role_key, status) values (${s.subject}, ${s.email}, ${s.name}, ${s.role}, 'active') returning id
    `
    if (!row) throw new Error('staff insert returned no row')
    staffIds.set(s.key, row.id)
    staffByName.set(s.name, row.id)
    counts.staff += 1
  }

  const partnerIds = new Map<string, string>()
  const planIds = new Map<string, string>()
  const partnerUserByName = new Map<string, string>()

  for (const p of partners) {
    const partnerId = await seedPartner(tx, p, now, record, partnerUserByName, staffByName)
    partnerIds.set(p.key, partnerId)
    counts.partners += 1
    counts.partnerUsers += 1 + p.team.length
    for (const plan of p.plans) {
      planIds.set(`${p.key}:${plan.name}`, await insertPlan(tx, { partnerId, name: plan.name, status: plan.status, trialDays: plan.trialDays ?? 14, maxProducts: plan.maxProducts, maxStaff: plan.maxStaff }))
      counts.plans += 1
    }
  }

  for (const s of staff) {
    for (const key of s.partners ?? []) {
      const partnerId = partnerIds.get(key)
      const staffId = staffIds.get(s.key)
      if (partnerId && staffId) await tx`insert into staff_partner_assignment (staff_user_id, partner_id, created_at) values (${staffId}, ${partnerId}, ${now})`
    }
  }

  const planFor = (partner: string, name: string): string => {
    const id = planIds.get(`${partner}:${name}`)
    if (!id) throw new Error(`seed: partner ${partner} has no plan ${name}`)
    return id
  }
  const partnerFor = (key: string): string => {
    const id = partnerIds.get(key)
    if (!id) throw new Error(`seed: no partner ${key}`)
    return id
  }
  const actorFor = (name: string | null) =>
    name === null
      ? { actorKind: 'job' as const, actorId: 'provision-store', actorLabel: 'Signup' }
      : staffByName.has(name)
        ? { actorKind: 'staff' as const, actorId: staffByName.get(name) ?? null, actorLabel: name }
        : { actorKind: 'partner_user' as const, actorId: partnerUserByName.get(name) ?? null, actorLabel: name }

  for (const s of stores) {
    await seedStore(tx, s, now, partnerFor(s.partner), planFor(s.partner, s.plan), staffIds, record, actorFor, counts)
  }

  // Generated stores: a spread of states and ages, newest first in the lists.
  for (const spec of generated) {
    for (let i = 0; i < spec.count; i += 1) {
      const { name, code } = generatedName(spec.partner, i)
      const status: StoreStatus = (['active', 'active', 'active', 'trial', 'active', 'past_due', 'active', 'cancelled'] as const)[i % 8] ?? 'active'
      const createdDaysAgo = 20 + i * 7
      const ownerName = `${name.split(' ')[0]} Owner`
      await seedStore(
        tx,
        {
          key: `${spec.partner}-g${i}`,
          name,
          code,
          partner: spec.partner,
          country: spec.country,
          plan: spec.plans[i % spec.plans.length] ?? spec.plans[0] ?? '',
          status,
          createdDaysAgo,
          ...(status === 'trial' ? { trialEndsInDays: 3 + (i % 10) } : {}),
          ...(status === 'past_due' ? { pastDueDays: 1 + (i % 12) } : {}),
          ...(status === 'cancelled' ? { cancelledDaysAgo: 1 + (i % 20) } : {}),
          coreVersion: `v${10 + (i % 30)}`,
          built: true,
          people: [{ name: ownerName, email: `owner@${code}.example`, role: 'owner', status: 'active', lastSignInDaysAgo: i % 14 }],
          events: [
            { daysAgo: createdDaysAgo, action: 'store.trial_started', by: null },
            ...(status === 'active' || status === 'past_due' || status === 'cancelled' ? [{ daysAgo: createdDaysAgo - 10, action: 'store.activated' as const, by: null }] : []),
          ],
        },
        now,
        partnerFor(spec.partner),
        planFor(spec.partner, spec.plans[i % spec.plans.length] ?? spec.plans[0] ?? ''),
        staffIds,
        record,
        actorFor,
        counts,
      )
    }
  }

  return counts
}

const seedPartner = async (
  tx: ScopedSql,
  p: SeedPartner,
  now: Date,
  record: (entry: ActivityEntry) => Promise<void>,
  partnerUserByName: Map<string, string>,
  staffByName: Map<string, string>,
): Promise<string> => {
  const created = daysAgo(now, p.createdDaysAgo)
  const partnerId = await insertPartner(tx, {
    name: p.name,
    isHouse: p.house ?? false,
    kind: p.kind,
    region: p.region,
    country: p.country,
    state: p.state,
    productName: p.productName,
    primaryColor: p.primaryColor,
    accentColor: p.accentColor,
    poweredBy: p.poweredBy,
    fallbackSenderAccepted: p.fallbackSenderAccepted ?? false,
    createdAt: created,
  })

  // The facts of the state, through the same writer the state machine uses.
  const submitted = [...p.events].reverse().find((e) => e.action === 'partner.submitted')
  const approved = p.events.find((e) => e.action === 'partner.approved')
  const paused = [...p.events].reverse().find((e) => e.action === 'partner.paused')
  const sentBack = [...p.events].reverse().find((e) => e.action === 'partner.sent_back')
  await updatePartnerState(tx, partnerId, {
    state: p.state,
    submittedAt: submitted ? daysAgo(now, submitted.daysAgo) : null,
    submittedByKind: submitted ? 'partner_user' : null,
    submittedByLabel: submitted?.by ?? null,
    sentBackReason: p.state === 'draft' && sentBack ? (sentBack.reason ?? null) : null,
    approvedAt: approved ? daysAgo(now, approved.daysAgo) : null,
    pausedAt: p.state === 'paused' && paused ? daysAgo(now, paused.daysAgo) : null,
    pauseReason: p.state === 'paused' ? (p.pauseReason ?? paused?.reason ?? null) : null,
  })

  const ownerId = await insertPartnerUser(tx, {
    partnerId,
    email: p.owner.email,
    name: p.owner.name,
    role: p.owner.role,
    status: p.owner.invitation === 'active' ? 'active' : 'invited',
    lastSignInAt: p.owner.lastSignInDaysAgo === null ? null : daysAgo(now, p.owner.lastSignInDaysAgo),
  })
  partnerUserByName.set(p.owner.name, ownerId)
  await insertPartnerInvitation(tx, {
    partnerId,
    partnerUserId: ownerId,
    sentAt: p.owner.invitation === 'held' ? null : created,
    expiresAt: p.owner.invitation === 'held' ? null : new Date(created.getTime() + 7 * 24 * 60 * 60 * 1000),
    invitedByKind: 'staff',
    invitedByLabel: p.events[0]?.by ?? 'DripFunnel',
    acceptedAt: p.owner.invitation === 'active' ? created : null,
  })
  for (const member of p.team) {
    const id = await insertPartnerUser(tx, {
      partnerId,
      email: member.email,
      name: member.name,
      role: member.role,
      status: member.lastSignInDaysAgo === null ? 'invited' : 'active',
      lastSignInAt: member.lastSignInDaysAgo === null ? null : daysAgo(now, member.lastSignInDaysAgo),
    })
    partnerUserByName.set(member.name, id)
  }

  for (const d of domainsFor(p)) {
    const { recordType, expected } = recordFor(d.kind)
    await upsertPartnerDomain(tx, {
      partnerId,
      kind: d.kind,
      host: d.host,
      status: d.status,
      recordType,
      expected,
      found: d.status === 'live' ? expected : (d.found ?? null),
      checkedAt: minutesAgo(now, 30),
    })
  }

  for (const item of p.setup) {
    const byStaff = item.by !== undefined && staff.some((s) => s.name === item.by)
    await upsertSetupItem(tx, {
      partnerId,
      item: item.item,
      status: item.status,
      detail: item.detail,
      doneByKind: item.status === 'done' ? (byStaff ? 'staff' : 'partner_user') : null,
      doneByLabel: item.status === 'done' ? (byStaff ? 'DripFunnel' : (item.by ?? p.owner.name)) : null,
      doneAt: item.status === 'done' ? daysAgo(now, Math.max(0, p.createdDaysAgo - 2)) : null,
    })
  }

  for (const e of p.events) {
    const byStaff = staff.some((s) => s.name === e.by)
    // A "set up" event is a setup session that ran its two hours (ACCESS.md §8.2).
    const staffId = staffByName.get(e.by)
    if (e.action === 'partner.set_up' && staffId) {
      const startedAt = daysAgo(now, e.daysAgo)
      const sessionId = await insertSetupSession(tx, {
        staffUserId: staffId,
        partnerId,
        reason: 'Set up on the partner\'s behalf',
        ticket: null,
        startedAt,
        expiresAt: new Date(startedAt.getTime() + 2 * 60 * 60 * 1000),
        handoffHash: `seed-${partnerId}-${e.daysAgo}`,
        handoffExpiresAt: startedAt,
      })
      if (!sessionId) throw new Error(`seed: ${e.by} already has an open setup session`)
      await endSetupSession(tx, sessionId, staffId, new Date(startedAt.getTime() + 2 * 60 * 60 * 1000))
    }
    await record({
      occurredAt: daysAgo(now, e.daysAgo),
      category: 'write',
      action: e.action,
      result: 'success',
      actorKind: byStaff ? 'staff' : 'partner_user',
      actorId: null,
      actorLabel: e.by,
      partnerId,
      target: { type: 'partner', id: partnerId, label: p.name },
      reason: e.reason ?? null,
      api: byStaff ? 'admin' : 'platform',
      requestId: null,
      ip: null,
      userAgent: null,
      visibility: 'partner',
    })
  }
  return partnerId
}

const seedStore = async (
  tx: ScopedSql,
  s: SeedStore,
  now: Date,
  partnerId: string,
  planId: string,
  staffIds: Map<string, string>,
  record: (entry: ActivityEntry) => Promise<void>,
  actorFor: (name: string | null) => Pick<ActivityEntry, 'actorKind' | 'actorId' | 'actorLabel'>,
  counts: SeedCounts,
): Promise<void> => {
  const created = daysAgo(now, s.createdDaysAgo)
  const storefrontKind = s.storefront === 'own' ? 'own' : 'ai'
  const buildState = s.storefront === 'own' ? null : (s.storefront ?? 'live')
  const storeId = await insertStore(tx, {
    partnerId,
    name: s.name,
    code: s.code,
    country: s.country,
    status: s.status === 'suspended' ? (s.suspended?.previous ?? 'active') : s.status,
    planId,
    trialEndsAt: s.trialEndsInDays !== undefined ? daysAgo(now, -s.trialEndsInDays) : null,
    pastDueSince: s.pastDueDays !== undefined ? daysAgo(now, s.pastDueDays) : null,
    cancelledAt: s.cancelledDaysAgo !== undefined ? daysAgo(now, s.cancelledDaysAgo) : null,
    storefrontKind,
    buildState,
    coreVersion: s.coreVersion ?? null,
    lastBuildAt: s.built ? minutesAgo(now, 170) : null,
    lastPublishAt: s.built ? minutesAgo(now, 160) : null,
    supportAccessAllowed: s.supportAccess ?? true,
    createdAt: created,
  })
  counts.stores += 1
  if (s.suspended) {
    await updateStoreStatus(tx, storeId, {
      status: 'suspended',
      suspendedAt: daysAgo(now, s.suspended.daysAgo),
      suspendedReason: s.suspended.reason,
      suspendedByLabel: s.suspended.by,
      suspendedPreviousStatus: s.suspended.previous,
    })
  }

  if (s.customDomain) {
    await insertCustomDomain(tx, {
      storeId,
      host: s.customDomain.host,
      status: s.customDomain.status,
      expectedCname: 'shops.edge.dripfunnel.example',
      foundCname: s.customDomain.status === 'live' ? 'shops.edge.dripfunnel.example' : null,
      ownershipToken: `df-verify=${s.code}`,
      ownershipFound: s.customDomain.status === 'live' ? `df-verify=${s.code}` : null,
      checkedAt: minutesAgo(now, 20),
    })
  }

  const sellerIds = new Map<string, string>()
  for (const supplier of s.suppliers ?? []) sellerIds.set(supplier, await insertSeller(tx, { storeId, name: supplier }))
  for (const person of s.people) {
    const userId = await insertUser(tx, {
      partnerId,
      email: person.email,
      name: person.name,
      status: person.status === 'invited' ? 'invited' : 'active',
      lastSignInAt: person.lastSignInDaysAgo === null ? null : daysAgo(now, person.lastSignInDaysAgo),
    })
    const sellerId = person.supplier ? (sellerIds.get(person.supplier) ?? null) : null
    await insertMembership(tx, { userId, storeId, sellerId, role: person.role, status: person.status })
    counts.people += 1
  }

  const steps = stepsFor(storefrontKind)
  if (s.job) {
    await insertJob(tx, {
      storeId,
      state: s.job.state,
      steps,
      step: s.job.step,
      attempts: s.job.attempts,
      startedAt: minutesAgo(now, s.job.minutesAgo),
      stepStartedAt: minutesAgo(now, s.job.stepMinutesAgo),
      lastError: s.job.error ?? null,
      details: s.job.details ?? null,
    })
  } else {
    const last: ProvisioningStep = steps[steps.length - 1] ?? 'done'
    await insertJob(tx, { storeId, state: 'done', steps, step: last, startedAt: created, stepStartedAt: created, finishedAt: new Date(created.getTime() + 102_000) })
  }
  counts.jobs += 1

  for (const note of s.notes ?? []) {
    const staffUserId = staffIds.get(note.by)
    if (staffUserId) await insertStoreNote(tx, { storeId, staffUserId, text: note.text, createdAt: minutesAgo(now, note.minutesAgo) })
  }

  for (const e of s.events) {
    await record({
      occurredAt: daysAgo(now, e.daysAgo),
      category: e.by === null ? 'system' : 'write',
      action: e.action,
      result: 'success',
      ...actorFor(e.by),
      partnerId,
      storeId,
      target: { type: 'store', id: storeId, label: s.name },
      reason: e.reason ?? null,
      api: e.by === null ? 'system' : 'platform',
      requestId: null,
      ip: null,
      userAgent: null,
      visibility: 'partner',
    })
  }
}
