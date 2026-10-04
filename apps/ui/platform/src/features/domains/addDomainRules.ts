import type { AddRefusal, Address, DomainKind } from '../../api/domains'
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

const prefixes: Record<DomainKind, string> = { portal: 'store', preview: 'preview', shops: 'shops', email: 'mail' }

// The example each hint names, under the zone of an address already added, if any.
export const exampleFor = (kind: DomainKind, zone: string | null): string => `${prefixes[kind]}.${zone ?? 'yourcompany.com'}`

export const zoneIn = (addresses: readonly Address[]): string | null => addresses.find((a): a is Extract<Address, { added: true }> => a.added)?.zone ?? null

export const refusalText = (reason: AddRefusal, example: string): string => fill(words.refused[reason], { example })

export const helpText = (kind: DomainKind, example: string): string =>
  kind === 'portal' ? fill(words.help.portal, { example }) : isWildcard(kind) ? fill(words.help.wildcard, { example }) : words.help.email

// The first kind not yet added, or the one a link asked for when it is free (§9.2: portal first).
export const firstKind = (addresses: readonly Address[], asked: DomainKind | undefined): DomainKind => {
  const free = addresses.filter((a) => !a.added).map((a) => a.kind)
  return asked && free.includes(asked) ? asked : (free[0] ?? 'portal')
}
