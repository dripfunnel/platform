import { describe, expect, it } from 'vitest'
import { alarmStep, studioIdleMs } from './alarm'

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
