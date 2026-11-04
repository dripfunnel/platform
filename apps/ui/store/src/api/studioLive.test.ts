// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { rememberActing } from '../acting'
import { liveRetryMs, openStudioLive, type LiveEvent } from './studio'

// The studio's live socket (#1237): one-way, reconnecting with the last event seen so only the missed ones come again.

class FakeSocket {
  onopen: (() => void) | null = null
  onmessage: ((m: MessageEvent) => void) | null = null
  onclose: (() => void) | null = null
  closed = false
  constructor(readonly url: string) {}
  close() {
    this.closed = true
  }
  deliver(e: Partial<LiveEvent> | string) {
    this.onmessage?.({ data: typeof e === 'string' ? e : JSON.stringify(e) } as MessageEvent)
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('openStudioLive', () => {
  it('opens the portal’s own /api/studio/live with the session, the acting store and the last event, and reconnects after a drop', () => {
    vi.useFakeTimers()
    rememberActing({ storeId: 'store-1', supplierId: null })
    const made: FakeSocket[] = []
    const got: LiveEvent[] = []
    const ups: boolean[] = []
    const live = openStudioLive('session-1', (e) => got.push(e), (up) => ups.push(up), (url) => {
      const s = new FakeSocket(url)
      made.push(s)
      return s as unknown as WebSocket
    })
    const first = new URL(made[0]?.url ?? '')
    expect(first.pathname).toBe('/api/studio/live')
    expect(first.host).toBe(window.location.host)
    expect(Object.fromEntries(first.searchParams)).toEqual({ session: 'session-1', after: '0', store: 'store-1' })
    made[0]?.onopen?.()
    made[0]?.deliver({ seq: 1, run: 'r', type: 'step', step: 'reading' })
    made[0]?.deliver({ seq: 2, run: 'r', type: 'step', step: 'asking' })
    made[0]?.deliver('not json')
    made[0]?.deliver({ seq: 3, run: 'r', type: 'step', step: 'unknown' } as unknown as LiveEvent)
    made[0]?.onclose?.()
    expect(ups).toEqual([true, false])
    vi.advanceTimersByTime(liveRetryMs[0])
    expect(new URL(made[1]?.url ?? '').searchParams.get('after')).toBe('2')
    // A replay that overlaps what was seen gives each event once.
    made[1]?.deliver({ seq: 2, run: 'r', type: 'step', step: 'asking' })
    made[1]?.deliver({ seq: 3, run: 'r', type: 'done', outcome: 'changed', messageId: 'm1' })
    expect(got.map((e) => e.seq)).toEqual([1, 2, 3])
    live.close()
    expect(made[1]?.closed).toBe(true)
    made[1]?.onclose?.()
    vi.advanceTimersByTime(60_000)
    expect(made).toHaveLength(2)
  })
})
