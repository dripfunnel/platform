import type { StatusIconName, StatusTone } from '@dripfunnel/shared/ui'
import { isApiError } from '@dripfunnel/shared/graphql'
import type { DomainStatus, StorefrontDomain } from '../../api/storefront'
import { fill, messages } from '../../messages'

const words = messages.storefront.domains

// The built states (DATA-MODEL §7.2) read as PortalStorefront's three, plus failed and the two a live domain can fall into.
const looks: Record<DomainStatus, { tone: StatusTone; icon: StatusIconName }> = {
  waiting: { tone: 'warning', icon: 'hour' },
  verifying: { tone: 'info', icon: 'clock' },
  issuing: { tone: 'info', icon: 'clock' },
  live: { tone: 'success', icon: 'ok' },
  expiring: { tone: 'info', icon: 'clock' },
  failed: { tone: 'danger', icon: 'cross' },
  broken: { tone: 'danger', icon: 'cross' },
}

export const domainPill = (status: DomainStatus) => ({ ...looks[status], label: words.status[status] })

const reachable = (d: StorefrontDomain) => d.status === 'live' || d.status === 'expiring'

export const domainNote = (d: StorefrontDomain): string => (d.kind === 'free' ? words.free : reachable(d) ? words.own : words.ownPending)

/** Shoppers reach it, so it can be the address the others redirect to (SAAS §8). */
export const canMakePrimary = (d: StorefrontDomain): boolean => !d.primary && reachable(d)

/** DNS is what's missing: the records to add, Check now and Cancel. */
export const needsRecords = (d: StorefrontDomain): boolean => d.kind === 'custom' && (d.status === 'waiting' || d.status === 'failed' || d.status === 'broken')

/** Still on its way to live: the list is read again until it settles. */
export const inProgress = (domains: readonly StorefrontDomain[]): boolean => domains.some((d) => d.status === 'waiting' || d.status === 'verifying' || d.status === 'issuing')

export const recordsTitle = (d: StorefrontDomain): string => fill(d.status === 'failed' ? words.records.failed : d.status === 'broken' ? words.records.broken : words.records.title, { host: d.host })

/** The API's refusal in the Domains card's words; a bare domain names the subdomain to use instead. */
export const domainRefusal = (error: unknown): string => {
  if (!isApiError(error)) return words.refused.other
  const suggested = error.details['suggested']
  if (error.code === 'APEX_NOT_AVAILABLE' && typeof suggested === 'string') return fill(words.refused.APEX_NOT_AVAILABLE, { suggested })
  if (error.code === 'APEX_NOT_AVAILABLE') return words.refused.INVALID_HOSTNAME
  return (words.refused as Record<string, string>)[error.code] ?? words.refused.other
}
