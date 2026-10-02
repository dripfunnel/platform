// DNS over HTTPS against one fixed resolver (RFC 8484, JSON form). The user's hostname travels
// as a query parameter to a URL we own, never as a host we connect to.
export interface DnsLookup {
  /** The record values found, in order; empty when there is none. */
  resolve: (host: string, type: 'CNAME' | 'TXT', signal: AbortSignal) => Promise<string[]>
}

const resolverUrl = 'https://cloudflare-dns.com/dns-query'

interface DohAnswer {
  Answer?: { type: number; data: string }[]
}

const types = { CNAME: 5, TXT: 16 } as const

const unquote = (txt: string): string => txt.replace(/^"|"$/g, '').replaceAll('" "', '')

export const dohLookup = (fetchImpl: typeof fetch = fetch): DnsLookup => ({
  resolve: async (host, type, signal) => {
    const url = new URL(resolverUrl)
    url.searchParams.set('name', host)
    url.searchParams.set('type', type)
    const response = await fetchImpl(url, { headers: { accept: 'application/dns-json' }, signal })
    if (!response.ok) throw new Error(`resolver answered ${response.status}`)
    const body = (await response.json()) as DohAnswer
    return (body.Answer ?? [])
      .filter((answer) => answer.type === types[type])
      .map((answer) => (type === 'TXT' ? unquote(answer.data) : answer.data.replace(/\.$/, '').toLowerCase()))
  },
})
