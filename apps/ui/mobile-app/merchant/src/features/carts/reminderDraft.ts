import { reminderText, type ReminderSettings, type ReminderSettingsInput, type ReminderStep } from '../../api/carts'
import { minorOf, moneyText } from '../../format'

// The reminder settings as the form holds them: the minimum typed in major units, the steps as read. Saved as one, at the revision read.

export type ReminderDraft = {
  enabled: boolean
  minimum: string
  skipOutOfStock: boolean
  quietHours: boolean
  weeklyCap: boolean
  steps: ReminderStep[]
}

export const draftOf = (settings: ReminderSettings): ReminderDraft => ({
  enabled: settings.enabled,
  minimum: settings.minimum ? moneyText(settings.minimum) : '',
  skipOutOfStock: settings.skipOutOfStock,
  quietHours: settings.quietHours,
  weeklyCap: settings.weeklyCap,
  steps: [...settings.steps].sort((a, b) => a.position - b.position).map((step) => ({ ...step })),
})

export const sameDraft = (a: ReminderDraft, b: ReminderDraft): boolean => JSON.stringify(a) === JSON.stringify(b)

export type StepProblem = 'later' | 'subject' | 'long'

/** Whether a step past the first is drawn at all: below the plan's `automatic` the later steps are locked and sent back as read. */
export const stepLocked = (index: number, automatic: boolean): boolean => !automatic && index > 0

/**
 * Each step's problem, as the API would refuse it: later than the one before, and a subject for an email (#321). A locked or
 * switched-off step is sent back as read and never blocks a save.
 */
export const stepProblems = (steps: readonly ReminderStep[], automatic: boolean): (StepProblem | null)[] =>
  steps.map((step, index) => {
    if (!step.enabled || stepLocked(index, automatic)) return null
    const before = steps.slice(0, index).filter((other, at) => other.enabled && !stepLocked(at, automatic)).pop()
    if (before && step.delayMinutes <= before.delayMinutes) return 'later'
    if (step.channel === 'email' && !step.subject.trim()) return 'subject'
    if (step.subject.trim().length > reminderText.subject || step.body.trim().length > reminderText.body) return 'long'
    return null
  })

/** The minimum as minor units, null for none; `'invalid'` for what isn't a cart value above zero. */
export const minimumOf = (draft: ReminderDraft, currency: string): string | null | 'invalid' => {
  const minor = minorOf(draft.minimum, currency)
  return minor === 'invalid' || (minor !== null && /^0+$/.test(minor)) ? 'invalid' : minor
}

/** What the API takes: the minimum in minor units of the store's currency, and every step trimmed. */
export const inputOf = (draft: ReminderDraft, currency: string): ReminderSettingsInput => {
  const minimum = minimumOf(draft, currency)
  return {
    enabled: draft.enabled,
    minimum: minimum !== null && minimum !== 'invalid' ? { amount: minimum, currency } : null,
    skipOutOfStock: draft.skipOutOfStock,
    quietHours: draft.quietHours,
    weeklyCap: draft.weeklyCap,
    steps: draft.steps.map((step) => ({ ...step, subject: step.subject.trim(), body: step.body.trim() })),
  }
}

/** What stops a save before anything is sent: the first step with a problem, or the minimum. */
export const draftProblem = (draft: ReminderDraft, currency: string, automatic: boolean): { kind: 'step'; step: ReminderStep; problem: StepProblem } | { kind: 'minimum' } | null => {
  const problems = stepProblems(draft.steps, automatic)
  const at = problems.findIndex((problem) => problem !== null)
  const step = draft.steps[at]
  const problem = problems[at]
  if (step && problem) return { kind: 'step', step, problem }
  return minimumOf(draft, currency) === 'invalid' ? { kind: 'minimum' } : null
}
