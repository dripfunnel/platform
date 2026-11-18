import { describe, expect, it } from 'vitest'
import type { MessageRow } from '#db/scoped/design'
import { designRunId, heldRun, outputOf, runOutput } from './runs'

describe('a design run’s output', () => {
  it('is the outcome and the message id, plain JSON, never the message row with its dates', () => {
    const message = { id: 'm1', created_at: new Date(0), text: 'I made the buttons maroon.' } as unknown as MessageRow
    const output = runOutput({ ok: true, value: { outcome: 'changed', message } })
    expect(output).toEqual({ ok: true, outcome: 'changed', messageId: 'm1' })
    expect(JSON.parse(JSON.stringify(output))).toEqual(output)
  })

  it('keeps a refusal’s code and its facts, so designRun answers as the request would have', () => {
    expect(runOutput({ ok: false, reason: 'STUDIO_QUEUED', place: 3 })).toEqual({ ok: false, reason: 'STUDIO_QUEUED', place: 3 })
    expect(runOutput({ ok: false, reason: 'AI_BUDGET_REACHED' })).toEqual({ ok: false, reason: 'AI_BUDGET_REACHED' })
  })

  it('reads back only an output with its ok flag', () => {
    expect(outputOf.safeParse({ ok: true, outcome: 'cancelled', messageId: null }).success).toBe(true)
    expect(outputOf.safeParse(undefined).success).toBe(false)
    expect(outputOf.safeParse({ outcome: 'changed' }).success).toBe(false)
  })
})

describe('a held request', () => {
  const facts = { requestId: 'r', ip: null, userAgent: null }

  it('is an ask or a build with its facts; anything else is nothing to take', () => {
    expect(heldRun.safeParse({ kind: 'build', messageId: 'm', model: null, facts }).success).toBe(true)
    expect(heldRun.safeParse({ kind: 'ask', facts, input: { text: 'x', model: null, imageAssetId: null, sampleUrl: null, page: 'home', device: 'phone', mode: 'change' } }).success).toBe(true)
    expect(heldRun.safeParse(null).success).toBe(false)
    expect(heldRun.safeParse({ kind: 'build', messageId: 'm', model: null }).success).toBe(false)
  })

  it('runs under an id unique to its store', () => {
    expect(designRunId('s1', 'r1')).toBe('s1-r1')
  })
})
