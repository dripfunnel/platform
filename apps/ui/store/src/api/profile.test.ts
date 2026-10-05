import { afterEach, describe, expect, it, vi } from 'vitest'

const answering = (data: unknown) => {
  const sent: { query: string; variables: Record<string, unknown> | undefined }[] = []
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)) as { query: string; variables: Record<string, unknown> | undefined })
    return new Response(JSON.stringify({ data }))
  })
  return sent
}

afterEach(() => vi.unstubAllGlobals())

describe('the profile API', () => {
  const step = { secret: null, uri: null, hint: '•••• 1234', done: false, backupCodes: null }

  it('starts a method with the password and confirms it with the code alone', async () => {
    const sent = answering({ setSecondFactor: step })
    const { confirmSecondFactor, startSecondFactor, turnOffSecondFactor } = await import('./profile')
    await startSecondFactor('sms', 'pw')
    await confirmSecondFactor('sms', '123456')
    await turnOffSecondFactor('pw')
    expect(sent.map((s) => s.variables)).toEqual([
      { method: 'sms', password: 'pw' },
      { method: 'sms', code: '123456' },
      { method: 'off', password: 'pw' },
    ])
  })

  it('pages the person’s activity, twenty at a time, with no next page at the end', async () => {
    const entry = { id: 'a1', occurredAt: '2026-10-05T00:00:00.000Z', action: 'person.signed_in', result: 'success', storeId: null, target: null }
    const sent = answering({ myActivity: { nodes: [entry], pageInfo: { hasNextPage: true, endCursor: 'c1' } } })
    const { activityPageSize, loadMyActivity } = await import('./profile')
    expect(await loadMyActivity(null)).toEqual({ entries: [entry], next: 'c1' })
    expect(sent[0]?.variables).toEqual({ first: activityPageSize, after: null })
    answering({ myActivity: { nodes: [], pageInfo: { hasNextPage: false, endCursor: 'c2' } } })
    expect((await loadMyActivity('c1')).next).toBeNull()
  })

  it('refuses an answer whose shape drifted from the schema', async () => {
    answering({ profile: { name: 'Farhan' } })
    const { loadProfile } = await import('./profile')
    await expect(loadProfile()).rejects.toThrow()
  })
})
