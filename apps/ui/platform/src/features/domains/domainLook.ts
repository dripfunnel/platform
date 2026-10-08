import { ApiError } from '@dripfunnel/shared/graphql'
import type { StatusIconName, StatusTone } from '@dripfunnel/shared/ui'
import type { Address, DnsRecord, DomainKind, HostStatus, RemoveResult } from '../../api/domains'
import { fill, formatDate, formatWait, messages } from '../../messages'

const words = messages.domains

export const statusLook: Record<HostStatus, { tone: StatusTone; icon: StatusIconName }> = {
  waiting: { tone: 'warning', icon: 'hour' },
  verifying: { tone: 'info', icon: 'clock' },
  issuing: { tone: 'info', icon: 'clock' },
  live: { tone: 'success', icon: 'ok' },
  failed: { tone: 'danger', icon: 'cross' },
  expiring: { tone: 'warning', icon: 'alert' },
  broken: { tone: 'danger', icon: 'alert' },
}

export const statusPill = (status: HostStatus) => ({ ...statusLook[status], label: words.status[status] })

// Still being set up: waiting since it was added. Anything else, live or past it: when DNS was last read (§9.1).
const settingUp: readonly HostStatus[] = ['waiting', 'verifying', 'issuing']

export const whenText = (address: Extract<Address, { added: true }>, now: number): string => {
  if (settingUp.includes(address.status)) return fill(words.waitingSince, { date: formatDate(address.since) })
  if (!address.checkedAt) return words.notChecked
  const seconds = Math.max(0, Math.round((now - Date.parse(address.checkedAt)) / 1000))
  return seconds < 60 ? words.checkedNow : fill(words.checked, { wait: formatWait(seconds) })
}

// The plain-words line beside a record (§9.1): what it does, in the kind's own terms.
export const purposeText = (record: DnsRecord, kind: DomainKind): string => {
  if (record.purpose !== 'pointer') return words.purposes[record.purpose]
  if (kind === 'portal' && record.type === 'A') return words.purposes.pointer.apex
  return words.purposes.pointer[kind]
}

// Owners and Admins hold domains.write (ACCESS.md §5.3); the API refuses everyone else too.
export const canRemoveAddress = (role: string, supportSessionOpen: boolean): boolean => (role === 'partner-owner' || role === 'partner-admin') && !supportSessionOpen

// What the dialog says when a removal did not happen: a refusal the API answered, or a thrown failure.
export const removeFailure = (outcome: RemoveResult | Error, host: string): string | null => {
  if (outcome instanceof Error) return outcome instanceof ApiError && outcome.code === 'FORBIDDEN' ? words.remove.refused : words.remove.failed
  return outcome.ok ? null : fill(outcome.reason === 'NOT_FOUND' ? words.remove.gone : words.remove.failed, { host })
}
