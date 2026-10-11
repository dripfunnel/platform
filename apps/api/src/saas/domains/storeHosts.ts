import type { ScopedSql } from '#db/scoped/index'
import { insertOutboxMany } from '#db/scoped/outbox'
import { selectPartnerStoreCodes } from '#db/scoped/partnerDomains'
import { queueSideEffect } from '#saas/outbox/index'

// Each store's `{code}.shops.<partnerdomain>` is its own Cloudflare for SaaS hostname (SAAS §5 step 3, §8):
// wildcard custom hostnames need Enterprise. Its state is Cloudflare's; nothing is kept here.

export const storeHostSyncKind = 'store_host.sync'
export const storeHostsRegisterKind = 'store_hosts.register'
export const storeHostsRemoveKind = 'store_hosts.remove'
export const storeHostPageSize = 100

/** The store's host under its partner's shops address, which is stored as the wildcard `*.shops.<partnerdomain>`. */
export const shopsHostOf = (address: string, code: string): string => {
  if (!address.startsWith('*.')) throw new Error('shops address: not a wildcard')
  return `${code}${address.slice(1)}`.toLowerCase()
}

export interface StoreRef {
  partnerId: string
  storeId: string
}

/** Registers the store's host once its partner's shops address is live, or takes it out once the store is closed. */
export const queueStoreHostSync = (tx: ScopedSql, store: StoreRef, why: 'provisioned' | 'closed'): Promise<string | null> =>
  queueSideEffect(tx, { kind: storeHostSyncKind, idempotencyKey: why, payload: { partnerId: store.partnerId, storeId: store.storeId }, partnerId: store.partnerId, storeId: store.storeId })

export interface ShopsAddress {
  partnerId: string
  domainId: string
}

/** One going-live of the address: each starts a fan-out of its own, so a store made while it was broken is reached too. */
export interface ShopsAddressRound extends ShopsAddress {
  round: string
}

export interface RemovedShopsAddress extends ShopsAddress {
  host: string
}

/** A page of the fan-out after the shops address went live, from `after` (a store code); each page queues the next. */
export const queueStoreHostsRegistration = (tx: ScopedSql, address: ShopsAddressRound, after: string | null = null): Promise<string | null> =>
  queueSideEffect(tx, {
    kind: storeHostsRegisterKind,
    idempotencyKey: `${address.domainId}:${address.round}:${after ?? ''}`,
    payload: { partnerId: address.partnerId, domainId: address.domainId, round: address.round, after },
    partnerId: address.partnerId,
    storeId: null,
  })

/** A page of the fan-out after the shops address was removed; the address's row is gone, so its host travels along. */
export const queueStoreHostsRemoval = (tx: ScopedSql, address: RemovedShopsAddress, after: string | null = null): Promise<string | null> =>
  queueSideEffect(tx, {
    kind: storeHostsRemoveKind,
    idempotencyKey: `${address.domainId}:${after ?? ''}`,
    payload: { partnerId: address.partnerId, domainId: address.domainId, host: address.host, after },
    partnerId: address.partnerId,
    storeId: null,
  })

const nextPage = (page: readonly { code: string }[]): string | null => (page.length === storeHostPageSize ? (page.at(-1)?.code ?? null) : null)

/** One page of open stores, a sync each, keyed by the address so a store already queued, by another round or migration 0220's backfill, is not queued twice. */
export const registerStoreHostsPage = async (tx: ScopedSql, address: ShopsAddressRound, after: string | null): Promise<void> => {
  const page = await selectPartnerStoreCodes(tx, address.partnerId, after, storeHostPageSize, false)
  await insertOutboxMany(
    tx,
    page.map((s) => ({ kind: storeHostSyncKind, idempotencyKey: address.domainId, payload: { partnerId: address.partnerId, storeId: s.id }, partnerId: address.partnerId, storeId: s.id })),
  )
  const next = nextPage(page)
  if (next !== null) await queueStoreHostsRegistration(tx, address, next)
}

/** One page of stores, closed ones too in case a store's close raced the removal: each host goes through `domain.remove`. */
export const removeStoreHostsPage = async (tx: ScopedSql, address: RemovedShopsAddress, after: string | null): Promise<void> => {
  const page = await selectPartnerStoreCodes(tx, address.partnerId, after, storeHostPageSize, true)
  await insertOutboxMany(
    tx,
    page.map((s) => ({ kind: 'domain.remove', idempotencyKey: `${address.domainId}:removed`, payload: { host: shopsHostOf(address.host, s.code) }, partnerId: address.partnerId, storeId: s.id })),
  )
  const next = nextPage(page)
  if (next !== null) await queueStoreHostsRemoval(tx, address, next)
}
