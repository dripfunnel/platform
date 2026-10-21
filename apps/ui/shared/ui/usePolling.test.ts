import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pollWhileVisible } from './usePolling'

const page = (state: 'visible' | 'hidden') => {
  const listeners = new Map<string, () => void>()
  const events = { addEventListener: (type: string, l: () => void) => listeners.set(type, l), removeEventListener: (type: string) => listeners.delete(type) }
  const doc = { ...events, visibilityState: state as string }
  return { doc, win: { ...events }, fire: (type: string) => listeners.get(type)?.(), listeners }
}

describe('pollWhileVisible', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('asks at once and on every interval while the page is visible', () => {
    const p = page('visible')
    let calls = 0
    pollWhileVisible(() => (calls += 1), 1000, p)
    vi.advanceTimersByTime(3000)
    expect(calls).toBe(4)
  })

  it('does not ask while hidden, and asks once when the page is shown again', () => {
    const p = page('visible')
    let calls = 0
    pollWhileVisible(() => (calls += 1), 1000, p)
    p.doc.visibilityState = 'hidden'
    vi.advanceTimersByTime(5000)
    expect(calls).toBe(1)
    p.doc.visibilityState = 'visible'
    p.fire('visibilitychange')
    expect(calls).toBe(2)
  })

  it('stops and lets go of its listeners when cleaned up', () => {
    const p = page('visible')
    let calls = 0
    const stop = pollWhileVisible(() => (calls += 1), 1000, p)
    stop()
    vi.advanceTimersByTime(5000)
    expect(calls).toBe(1)
    expect(p.listeners.size).toBe(0)
  })
})
