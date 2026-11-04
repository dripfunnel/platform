import { describe, expect, it } from 'vitest'
import { alarmStep, studioIdleMs, sweepsAgain } from './alarm'

describe('the studio alarm (storefront AI-STUDIO §7)', () => {
  it('stops a container the object can no longer reach, after an eviction or a restart', () => {
    expect(alarmStep({ loaded: false, containerRunning: true, pending: 0, idleForMs: 0 })).toBe('stop-orphan')
    expect(alarmStep({ loaded: false, containerRunning: false, pending: 0, idleForMs: 0 })).toBe('rest')
  })

  it('stops an idle studio after 10 minutes, never with a change waiting, and renews a busy one', () => {
    expect(alarmStep({ loaded: true, containerRunning: true, pending: 0, idleForMs: studioIdleMs })).toBe('idle-stop')
    expect(alarmStep({ loaded: true, containerRunning: true, pending: 1, idleForMs: studioIdleMs * 2 })).toBe('renew')
    expect(alarmStep({ loaded: true, containerRunning: true, pending: 0, idleForMs: studioIdleMs - 1 })).toBe('renew')
  })
})

describe('the sweep of open sockets (AI-STUDIO §8, #1237)', () => {
  it('ticks again after any step while a frame or live socket is open, unless a tick is already set', () => {
    expect(sweepsAgain(1, null)).toBe(true)
    expect(sweepsAgain(1, Date.now() + 60_000)).toBe(false)
    expect(sweepsAgain(0, null)).toBe(false)
  })
})
