import { vi } from 'vitest'

// Stands in for the Admin API in a test: answers every request with the given GraphQL body and
// records what was asked, so a test can check the operation and its variables.
export const stubApi = (body: unknown, status = 200) => {
  const calls: { query: string; variables: Record<string, unknown> | undefined }[] = []
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body)) as (typeof calls)[number])
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetchMock)
  return { calls, restore: () => vi.unstubAllGlobals() }
}

// Answers each request with the next body in turn, for flows that ask more than once.
export const stubApiSequence = (...bodies: unknown[]) => {
  const calls: { query: string; variables: Record<string, unknown> | undefined }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)) as (typeof calls)[number])
      return new Response(JSON.stringify(bodies[calls.length - 1] ?? bodies.at(-1)), { headers: { 'content-type': 'application/json' } })
    }),
  )
  return { calls }
}
