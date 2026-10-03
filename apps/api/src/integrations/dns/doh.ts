import { z } from 'zod'

// DNS over HTTPS against one fixed resolver (RFC 8484, JSON form). The user's hostname travels
// as a query parameter to a URL we own, never as a host we connect to.
export type DnsRecordType = 'CNAME' | 'TXT' | 'A'

export interface DnsLookup {
  /** The record values found, in order; empty when there is none. */
  resolve: (host: string, type: DnsRecordType, signal: AbortSignal) => Promise<string[]>
}

const resolverUrl = 'https://cloudflare-dns.com/dns-query'

// Only what is read; the resolver's other fields are dropped rather than trusted.
const dohAnswer = z.object({ Answer: z.array(z.object({ type: z.number(), data: z.string() }).loose()).optional() }).loose()

const types = { A: 1, CNAME: 5, TXT: 16 } as const

const unquote = (txt: string): string => txt.replace(/^"|"$/g, '').replaceAll('" "', '')

export const dohLookup = (fetchImpl: typeof fetch = fetch): DnsLookup => ({
  resolve: async (host, type, signal) => {
    const url = new URL(resolverUrl)
    url.searchParams.set('name', host)
    url.searchParams.set('type', type)
    const response = await fetchImpl(url, { headers: { accept: 'application/dns-json' }, signal })
    if (!response.ok) throw new Error(`resolver answered ${response.status}`)
    const parsed = dohAnswer.safeParse(await response.json())
    if (!parsed.success) throw new Error('resolver answered in a shape we do not read')
    return (parsed.data.Answer ?? [])
      .filter((answer) => answer.type === types[type])
      .map((answer) => (type === 'TXT' ? unquote(answer.data) : answer.data.replace(/\.$/, '').toLowerCase()))
  },
})
