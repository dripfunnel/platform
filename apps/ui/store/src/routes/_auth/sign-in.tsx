import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { SignIn } from '../../features/auth/SignIn'
import { googleOutcomes } from '../../features/auth/refusals'

const search = z.object({
  next: z.string().optional(),
  note: z.enum(['signedOut', 'expired']).optional(),
  step: z.enum(['enrol', 'second-factor']).optional(),
  method: z.enum(['app', 'sms']).optional(),
  view: z.enum(['forgot']).optional(),
  // Back from Google without a session (ACCESS.md §2): why, and a lock's minutes.
  outcome: z.enum([...googleOutcomes, 'locked']).optional(),
  minutes: z.coerce.number().int().min(1).max(60).optional(),
})

const Screen = () => {
  const { next, note, step, method, view, outcome, minutes } = Route.useSearch()
  const resume = step === 'enrol' ? ({ step: 'enrol' } as const) : step === 'second-factor' ? ({ step: 'second-factor', method: method ?? 'sms' } as const) : undefined
  return <SignIn next={next} note={note} resume={resume} start={view} google={outcome === 'locked' ? { locked: minutes ?? 15 } : outcome} />
}

export const Route = createFileRoute('/_auth/sign-in')({ validateSearch: search, component: Screen })
