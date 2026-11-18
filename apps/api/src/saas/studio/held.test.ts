import { describe, expect, it } from 'vitest'
import { memoryKept } from '../../../tests/support/kept'
import { heldMs, heldRuns } from './held'

describe('a design run’s held request (AI-STUDIO §4 "A design run")', () => {
  it('is taken once, then nothing is there for a replayed step', async () => {
    const { storage } = memoryKept()
    const held = heldRuns(storage, () => 0)
    await held.hold('r1', { kind: 'build' })
    expect(await held.take('r1')).toEqual({ kind: 'build' })
    expect(await held.take('r1')).toBeNull()
  })

  it('is dropped after a day whenever one is held or taken, and a fresh one stays', async () => {
    const { storage, data } = memoryKept()
    let at = 1_000
    const held = heldRuns(storage, () => at)
    await held.hold('old', 'a')
    at += heldMs - 1
    await held.hold('fresh', 'b')
    at += 2
    expect(await held.take('old')).toBeNull()
    expect([...data.keys()]).toEqual(['held:fresh'])
    await held.hold('later', 'c')
    expect([...data.keys()].sort()).toEqual(['held:fresh', 'held:later'])
    at += heldMs + 1
    await held.hold('next', 'd')
    expect([...data.keys()]).toEqual(['held:next'])
  })

  it('drops one run, or every one waiting', async () => {
    const { storage, data } = memoryKept()
    const held = heldRuns(storage, () => 0)
    await held.hold('a', 1)
    await held.hold('b', 2)
    expect(await held.drop('a')).toBe(true)
    expect(await held.drop('a')).toBe(false)
    expect(await held.drop()).toBe(true)
    expect(data.size).toBe(0)
  })
})
