import type { ReminderSettings, ReminderStep } from '../../api/carts'
import { draftOf, draftProblem, inputOf, minimumOf, sameDraft, stepLocked, stepProblems } from './reminderDraft'

const step = (position: number, over: Partial<ReminderStep> = {}): ReminderStep => ({ position, enabled: true, delayMinutes: 60 * position, channel: 'email', subject: `Subject ${position}`, body: `Body ${position}`, discountPercent: null, ...over })

const settings = (over: Partial<ReminderSettings> = {}): ReminderSettings => ({
  enabled: true,
  minimum: { amount: '200000', currency: 'INR' },
  skipOutOfStock: true,
  quietHours: true,
  weeklyCap: true,
  steps: [step(1, { delayMinutes: 60 }), step(2, { delayMinutes: 1440 }), step(3, { delayMinutes: 4320 })],
  revision: 4,
  level: 'automatic',
  ...over,
})

describe('the reminder draft', () => {
  it('shows the minimum as the amount a person types, and the steps in order', () => {
    const draft = draftOf(settings({ steps: [step(3), step(1), step(2)] }))
    expect(draft.minimum).toBe('2000.00')
    expect(draft.steps.map((s) => s.position)).toEqual([1, 2, 3])
    expect(draftOf(settings({ minimum: null })).minimum).toBe('')
    expect(sameDraft(draft, draftOf(settings({ steps: [step(1), step(2), step(3)] })))).toBe(true)
  })

  it('sends the minimum as minor units in the store’s currency, and each step trimmed', () => {
    const draft = { ...draftOf(settings()), minimum: '1250.5' }
    draft.steps = draft.steps.map((s) => (s.position === 1 ? { ...s, subject: '  Come back  ', body: ' Your cart ' } : s))

    const input = inputOf(draft, 'INR')
    expect(input.minimum).toEqual({ amount: '125050', currency: 'INR' })
    expect(input.steps[0]).toMatchObject({ position: 1, subject: 'Come back', body: 'Your cart', channel: 'email', discountPercent: null })
    expect(input).not.toHaveProperty('revision')
    expect(input).not.toHaveProperty('level')
  })

  it('sends no minimum when the field is empty', () => {
    expect(inputOf({ ...draftOf(settings()), minimum: '' }, 'INR').minimum).toBeNull()
  })

  it('refuses a minimum that is zero or not an amount', () => {
    const draft = draftOf(settings())
    expect(minimumOf({ ...draft, minimum: '0' }, 'INR')).toBe('invalid')
    expect(minimumOf({ ...draft, minimum: '0.00' }, 'INR')).toBe('invalid')
    expect(minimumOf({ ...draft, minimum: '12.345' }, 'INR')).toBe('invalid')
    expect(minimumOf({ ...draft, minimum: '49' }, 'INR')).toBe('4900')
    expect(minimumOf({ ...draft, minimum: '' }, 'INR')).toBeNull()
  })
})

describe('the steps’ problems', () => {
  it('wants each step later than the one before', () => {
    const steps = [step(1, { delayMinutes: 240 }), step(2, { delayMinutes: 240 }), step(3, { delayMinutes: 4320 })]
    expect(stepProblems(steps, true)).toEqual([null, 'later', null])
  })

  it('compares with the last step that is on, not a switched-off one', () => {
    const steps = [step(1, { delayMinutes: 60 }), step(2, { delayMinutes: 4320, enabled: false }), step(3, { delayMinutes: 1440 })]
    expect(stepProblems(steps, true)).toEqual([null, null, null])
  })

  it('wants a subject for an email, but not for WhatsApp', () => {
    expect(stepProblems([step(1, { subject: '   ' })], true)).toEqual(['subject'])
    expect(stepProblems([step(1, { subject: '', channel: 'whatsapp' })], true)).toEqual([null])
  })

  it('refuses a subject or message past the API’s longest', () => {
    expect(stepProblems([step(1, { subject: 'x'.repeat(121) })], true)).toEqual(['long'])
    expect(stepProblems([step(1, { body: 'x'.repeat(501) })], true)).toEqual(['long'])
    expect(stepProblems([step(1, { subject: 'x'.repeat(120), body: 'x'.repeat(500) })], true)).toEqual([null])
  })

  it('never blocks a save on a step that is locked below automatic or switched off', () => {
    const steps = [step(1, { delayMinutes: 240 }), step(2, { delayMinutes: 30, subject: '' }), step(3, { delayMinutes: 30, enabled: false, subject: '' })]
    expect(stepLocked(0, false)).toBe(false)
    expect(stepLocked(1, false)).toBe(true)
    expect(stepLocked(1, true)).toBe(false)
    expect(stepProblems(steps, false)).toEqual([null, null, null])
    expect(stepProblems(steps, true)).toEqual([null, 'later', null])
  })
})

describe('what stops a save', () => {
  it('names the first step with a problem, before the minimum', () => {
    const draft = { ...draftOf(settings()), minimum: '0', steps: [step(1, { delayMinutes: 60 }), step(2, { delayMinutes: 60 }), step(3, { delayMinutes: 4320 })] }
    expect(draftProblem(draft, 'INR', true)).toMatchObject({ kind: 'step', problem: 'later', step: { position: 2 } })
  })

  it('names the minimum when the steps are fine, and nothing when all is well', () => {
    expect(draftProblem({ ...draftOf(settings()), minimum: 'abc' }, 'INR', true)).toEqual({ kind: 'minimum' })
    expect(draftProblem(draftOf(settings()), 'INR', true)).toBeNull()
  })
})
