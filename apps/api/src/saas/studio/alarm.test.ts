import { describe, expect, it } from 'vitest'
import { alarmStep, nextLookMs, studioActivityEveryMs, studioCapMs, studioClosedMs, studioIdleMs, studioTickMs, sweepsAgain, wakeStep, type AlarmState } from './alarm'

const open: AlarmState = { loaded: true, containerRunning: true, pending: 0, openStudios: 1, closedForMs: 0, idleForMs: 0, runningForMs: 0 }

describe('the studio alarm (storefront AI-STUDIO §7, #1241)', () => {
  it('stops a container the object can no longer reach, after an eviction or a restart', () => {
    expect(alarmStep({ ...open, loaded: false })).toBe('stop-orphan')
    expect(alarmStep({ ...open, loaded: false, containerRunning: false })).toBe('rest')
  })

  it('stops 2 minutes after the last studio closes, not before, and not while one is still open', () => {
    const closed = { ...open, openStudios: 0 }
    expect(alarmStep({ ...closed, closedForMs: studioClosedMs - 1 })).toBe('renew')
    expect(alarmStep({ ...closed, closedForMs: studioClosedMs })).toBe('closed-stop')
    expect(alarmStep({ ...open, closedForMs: studioClosedMs * 10 })).toBe('renew')
  })

  it('stops an open studio after 5 minutes without activity', () => {
    expect(alarmStep({ ...open, idleForMs: studioIdleMs - 1 })).toBe('renew')
    expect(alarmStep({ ...open, idleForMs: studioIdleMs })).toBe('idle-stop')
  })

  it('stops every session at 3 hours, busy or not', () => {
    expect(alarmStep({ ...open, runningForMs: studioCapMs - 1 })).toBe('renew')
    expect(alarmStep({ ...open, runningForMs: studioCapMs })).toBe('cap-stop')
  })

  it('never stops while a change runs or waits its turn', () => {
    expect(alarmStep({ ...open, pending: 1, openStudios: 0, closedForMs: studioClosedMs, idleForMs: studioIdleMs, runningForMs: studioCapMs })).toBe('renew')
  })

  it('looks again when the first stop is due, or at the lease’s tick', () => {
    expect(nextLookMs(open)).toBe(studioTickMs)
    expect(nextLookMs({ ...open, openStudios: 0, closedForMs: studioClosedMs - 20_000 })).toBe(20_000)
    expect(nextLookMs({ ...open, idleForMs: studioIdleMs - 5_000 })).toBe(5_000)
    expect(nextLookMs({ ...open, runningForMs: studioCapMs - 30_000 })).toBe(30_000)
    expect(nextLookMs({ ...open, idleForMs: studioIdleMs + 1 })).toBe(1_000)
  })
})

describe('studioActivity (AI-STUDIO §7 "Stopping", #1241)', () => {
  it('acts on one in 30 seconds, a stopped container’s as much as a running one’s', () => {
    expect(wakeStep(false, Number.POSITIVE_INFINITY)).toBe('open')
    expect(wakeStep(true, studioActivityEveryMs)).toBe('renew')
    expect(wakeStep(false, studioActivityEveryMs - 1)).toBe('skip')
    expect(wakeStep(true, studioActivityEveryMs - 1)).toBe('skip')
  })
})

describe('the sweep of open sockets (AI-STUDIO §8, #1237)', () => {
  it('ticks again after any step while a frame or live socket is open, unless a tick is already set', () => {
    expect(sweepsAgain(1, null)).toBe(true)
    expect(sweepsAgain(1, Date.now() + 60_000)).toBe(false)
    expect(sweepsAgain(0, null)).toBe(false)
  })
})
