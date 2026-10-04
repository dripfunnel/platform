import type { AddRefusal, Address, DomainKind, RecheckResult } from '../../api/domains'
import { fill, messages } from '../../messages'

const words = messages.domains.new

export const isWildcard = (kind: DomainKind): boolean => kind === 'preview' || kind === 'shops'

// What was typed, as a hostname: no scheme, path or `*.`; the API adds the wildcard's `*.` itself.
export const hostFrom = (typed: string): string =>
  typed
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^\*\./, '')
    .replace(/[/?#].*$/, '')

// The example each hint names, under the zone of an address already added, if any.
export const exampleFor = (kind: DomainKind, zone: string | null): string => fill(words.examples[kind], { zone: zone ?? words.examples.zone })

export const zoneIn = (addresses: readonly Address[]): string | null => addresses.find((a): a is Extract<Address, { added: true }> => a.added)?.zone ?? null

export const refusalText = (reason: AddRefusal, example: string): string => fill(words.refused[reason], { example })

export const helpText = (kind: DomainKind, example: string): string =>
  kind === 'portal' ? fill(words.help.portal, { example }) : isWildcard(kind) ? fill(words.help.wildcard, { example }) : words.help.email

// The first kind not yet added, or the one a link asked for when it is free (§9.2: portal first).
export const firstKind = (addresses: readonly Address[], asked: DomainKind | undefined): DomainKind => {
  const free = addresses.filter((a) => !a.added).map((a) => a.kind)
  return asked && free.includes(asked) ? asked : (free[0] ?? 'portal')
}

// What "Check now" leads to: step 3, with a note when the last check was under a minute ago (the
// queued one still runs), or an error for any other refusal.
export const afterRecheck = (result: RecheckResult, host: string): { failed: true } | { failed: false; note: string | null } =>
  result.ok ? { failed: false, note: null } : result.reason === 'TOO_SOON' ? { failed: false, note: fill(messages.domains.tooSoon, { host }) } : { failed: true }
