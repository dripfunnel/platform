import { describe, expect, it } from 'vitest'
import type { ActivityEntry } from '../../api/activity'
import { actionCodes, activityActions, activityLevels } from '../../api/activityActions'
import { generateActivity } from '../../api/activitySample'
import { messages } from '../../messages'
import { activityCsv } from './activityCsv'
import { actionText, entryParts, whoOf } from './activityText'

const words = messages.activity
const seed = generateActivity(Date.parse('2026-09-30T12:00:00Z'))

const entry = (overrides: Partial<ActivityEntry> = {}): ActivityEntry => ({
  id: 'e1',
  occurredAt: '2026-09-30T11:58:04.000Z',
  action: 'store.suspended',
  level: 'admin',
  result: 'success',
  actor: { kind: 'staff', id: 'st-arjun', label: 'Arjun Menon' },
  onBehalfOf: null,
  access: null,
  partner: { id: 'ns', name: 'Northstar Commerce' },
  store: { id: 's4', name: 'Redline Moto Parts' },
  target: { type: 'store', id: 's4', label: 'Redline Moto Parts' },
  changes: [],
  reason: null,
  requestId: 'req_1',
  ip: null,
  userAgent: null,
  ...overrides,
})

describe('action codes', () => {
  it('give every code a sentence and a filter name, and no message for a code that does not exist', () => {
    expect(Object.keys(words.actions).sort()).toEqual([...actionCodes].sort())
    expect(Object.keys(words.actionNames).sort()).toEqual([...actionCodes].sort())
  })

  it('put every code on a level the Action filter groups by', () => {
    for (const code of actionCodes) expect(activityLevels).toContain(activityActions[code].level)
  })

  it('never show a raw code in any sample sentence', () => {
    for (const sample of seed) {
      const text = actionText(sample)
      expect(text).not.toContain(sample.action)
      expect(text).not.toMatch(/\{\w+\}/)
    }
  })
})

describe('activity sentences', () => {
  it('names an impersonating agent with the account, and a support session by its agent', () => {
    expect(whoOf(entry({ actor: { kind: 'person', id: 'pe-s1', label: 'Priya Mehta' }, onBehalfOf: { id: 'st-neha', label: 'Neha Rao' } }))).toBe('Neha Rao as Priya Mehta')
    expect(whoOf(entry({ actor: { kind: 'support_session', id: 'ss-1', label: 'Maya Chen' }, onBehalfOf: { id: 'pu-mayachen', label: 'Maya Chen' } }))).toBe('Maya Chen')
  })

  it('says when a write was refused or failed', () => {
    expect(actionText(entry({ result: 'denied' }))).toBe(`${actionText(entry())} (refused)`)
    expect(actionText(entry({ result: 'failed' }))).toBe(`${actionText(entry())} (failed)`)
  })

  it('splits the sentence where the target goes, so the target can be a link', () => {
    const parts = entryParts(entry({ reason: 'Chargeback' }))
    expect(parts).toHaveLength(2)
    expect(parts.join('Redline Moto Parts')).toBe(`${actionText(entry())}: Chargeback`)
  })
})

describe('activityCsv', () => {
  const [header = '', ...rows] = activityCsv([
    entry({ ip: '103.21.4.5', userAgent: 'Firefox', changes: [{ field: 'Plan', before: 'Launch', after: 'Scale', redacted: false }, { field: 'Secret', before: null, after: null, redacted: true }] }),
  ]).split('\r\n')

  it('has the decided columns and no IP or user agent', () => {
    expect(header.split(',')).toEqual(Object.values(words.export.columns))
    expect(rows.join()).not.toContain('103.21.4.5')
    expect(rows.join()).not.toContain('Firefox')
  })

  it('puts the time in UTC and the changes in one cell, never a hidden value', () => {
    expect(rows[0]).toMatch(/^2026-09-30 11:58:04,/)
    expect(rows[0]).toContain('Plan: Launch → Scale; Secret: changed')
  })

  it('stops a label from running as a spreadsheet formula, and quotes commas', () => {
    const csv = activityCsv([entry({ target: { type: 'store', id: 's4', label: '=HYPERLINK("x")' }, reason: 'Late, again' })])
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`)
    expect(csv).toContain('"Late, again"')
  })
})
