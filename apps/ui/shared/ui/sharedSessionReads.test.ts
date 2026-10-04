import { describe, expect, it } from 'vitest'
import { createSharedSessionReads, identityChanged, sessionFreshMs, type SessionChannel } from './sharedSessionReads'
import type { PortalStaffSession } from './staffSession'

/** Tabs of one browser: what one posts, every other receives (BroadcastChannel never echoes). */
const browser = () => {
  const tabs = new Set<(event: MessageEvent) => void>()
  return (): SessionChannel => {
    let mine: ((event: MessageEvent) => void) | undefined
    return {
      postMessage: (message) => {
        for (const deliver of tabs) if (deliver !== mine) deliver({ data: structuredClone(message) } as MessageEvent)
      },
      addEventListener: (_type, listener) => {
        mine = listener
        tabs.add(listener)
      },
    }
  }
}

const session: PortalStaffSession = { id: 's-1', kind: 'setup', state: 'open', endedBy: null, staffName: 'Maya Ortiz', actingAs: null, partnerName: 'Tallis', host: 'platform.dripfunnel.com', expiresAt: '2026-10-05T12:00:00Z' }

const counting = (answer: PortalStaffSession | null) => {
  const calls = { n: 0 }
  return { calls, load: async () => ((calls.n += 1), answer) }
}

describe('shared staff-session reads', () => {
  it('asks once for every tab while the answer is fresh, and again once it is stale', async () => {
    let clock = 0
    const channel = browser()
    const [a, b] = [createSharedSessionReads({ now: () => clock, channel }), createSharedSessionReads({ now: () => clock, channel })]
    const notice = counting(session)
    expect(await a.read('notice', notice.load)).toEqual(session)
    expect(await b.read('notice', notice.load)).toEqual(session)
    expect(notice.calls.n).toBe(1)
    clock += sessionFreshMs
    await b.read('notice', notice.load)
    expect(notice.calls.n).toBe(2)
  })

  it('shares one request between callers in the same tab', async () => {
    const reads = createSharedSessionReads({ channel: () => null })
    const current = counting(session)
    await Promise.all([reads.read('current', current.load), reads.read('current', current.load)])
    expect(current.calls.n).toBe(1)
  })

  it('stops asking "mine" once there is no staff session, until a tab enters one', async () => {
    let clock = 0
    const channel = browser()
    const [a, b] = [createSharedSessionReads({ now: () => clock, channel }), createSharedSessionReads({ now: () => clock, channel })]
    const none = counting(null)
    await a.read('current', none.load)
    clock += sessionFreshMs * 10
    await a.read('current', none.load)
    await b.read('current', none.load)
    expect(none.calls.n).toBe(1)

    let told = 0
    a.onChanged(() => (told += 1))
    b.changed()
    expect(told).toBe(1)
    const entered = counting(session)
    expect(await a.read('current', entered.load)).toEqual(session)
    expect(entered.calls.n).toBe(1)
  })

  it('ignores a message that is not one of its own', async () => {
    let deliver: ((event: MessageEvent) => void) | undefined
    const reads = createSharedSessionReads({ channel: () => ({ postMessage: () => undefined, addEventListener: (_t, l) => (deliver = l) }) })
    const notice = counting(null)
    await reads.read('notice', notice.load)
    deliver?.({ data: { type: 'answer', read: 'other', value: session, at: Date.now() } } as MessageEvent)
    deliver?.({ data: 'changed' } as MessageEvent)
    expect(await reads.read('notice', notice.load)).toBeNull()
    expect(notice.calls.n).toBe(1)
  })

  it('drops an answer that was on its way when a session started, so "mine" is asked again', async () => {
    const reads = createSharedSessionReads({ channel: () => null })
    let answer: (value: PortalStaffSession | null) => void = () => undefined
    const stale = reads.read('current', () => new Promise((resolve) => (answer = resolve)))
    reads.changed()
    answer(null)
    expect(await stale).toBeNull()
    const entered = counting(session)
    expect(await reads.read('current', entered.load)).toEqual(session)
    expect(entered.calls.n).toBe(1)
  })

  it("ignores another tab's answer from before this tab's change", async () => {
    let clock = 100
    let deliver: ((event: MessageEvent) => void) | undefined
    const reads = createSharedSessionReads({ now: () => clock, channel: () => ({ postMessage: () => undefined, addEventListener: (_t, l) => (deliver = l) }) })
    reads.changed()
    clock = 101
    deliver?.({ data: { type: 'answer', read: 'notice', value: session, at: 99 } } as MessageEvent)
    const notice = counting(null)
    expect(await reads.read('notice', notice.load)).toBeNull()
    expect(notice.calls.n).toBe(1)
  })

  it('forgets everything when someone signs in or out, in every tab', async () => {
    const reads = createSharedSessionReads()
    const first = counting(session)
    await reads.read('notice', first.load)
    let told = 0
    reads.onChanged(() => (told += 1))
    identityChanged()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(told).toBe(1)
    const next = counting(null)
    expect(await reads.read('notice', next.load)).toBeNull()
    expect(next.calls.n).toBe(1)
  })
})
