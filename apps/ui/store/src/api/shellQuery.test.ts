import { describe, expect, it, vi } from 'vitest'

const sent: string[] = []
vi.mock('./client', () => ({
  query: (source: string) => {
    sent.push(source)
    return Promise.resolve({ storeState: null })
  },
  queryPartial: (source: string) => {
    sent.push(source)
    return Promise.resolve({ data: {}, errors: [] })
  },
}))

const { loadSupportBanner, readShell } = await import('./shell')

describe('the shell’s queries', () => {
  it('send the support banner’s fields in full, with no placeholder left in', async () => {
    await readShell()
    await loadSupportBanner()
    expect(sent).toHaveLength(2)
    for (const source of sent) {
      expect(source).not.toContain('${')
      expect(source).toContain('support { partnerName agentFirstName endsAt sessionId access allowedBy writeRequest { note state } extendable }')
    }
  })
})
