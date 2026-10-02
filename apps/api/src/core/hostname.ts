// A hostname a user typed (AGENTS.md "Security": SSRF protection on every user-supplied URL).
// Letters, digits and hyphens in labels, at most 253 characters, optionally one leading `*.`
// for a wildcard; never an address, a loopback or a local name. The checker only ever sends the
// name to a fixed resolver, so this is what keeps a typed address out of any request at all.

const label = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const localSuffixes = ['localhost', 'local', 'internal', 'localdomain', 'home', 'lan', 'arpa']

export type HostnameRefusal = 'EMPTY' | 'TOO_LONG' | 'BAD_LABEL' | 'IS_ADDRESS' | 'LOCAL_NAME' | 'NO_DOT'

export type ParsedHostname = { ok: true; host: string; wildcard: boolean } | { ok: false; code: HostnameRefusal }

const isIpv4 = (host: string): boolean => /^\d{1,3}(\.\d{1,3}){3}$/.test(host)
const isIpv6 = (host: string): boolean => host.includes(':') || /^\[.*\]$/.test(host)

export const parseHostname = (input: string): ParsedHostname => {
  const trimmed = input.trim().toLowerCase().replace(/\.$/, '')
  if (trimmed === '') return { ok: false, code: 'EMPTY' }
  if (trimmed.length > 253) return { ok: false, code: 'TOO_LONG' }
  if (isIpv4(trimmed) || isIpv6(trimmed)) return { ok: false, code: 'IS_ADDRESS' }
  const wildcard = trimmed.startsWith('*.')
  const host = wildcard ? trimmed.slice(2) : trimmed
  const labels = host.split('.')
  if (labels.length < 2) return { ok: false, code: 'NO_DOT' }
  if (!labels.every((part) => label.test(part))) return { ok: false, code: 'BAD_LABEL' }
  const last = labels.at(-1) ?? ''
  if (localSuffixes.includes(last) || /^\d+$/.test(last)) return { ok: false, code: 'LOCAL_NAME' }
  return { ok: true, host: trimmed, wildcard }
}
