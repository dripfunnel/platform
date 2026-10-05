import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { SignIn } from '../../features/auth/SignIn'

const search = z.object({
  next: z.string().optional(),
  note: z.enum(['signedOut', 'expired']).optional(),
  step: z.enum(['enrol', 'second-factor']).optional(),
  method: z.enum(['app', 'sms']).optional(),
  view: z.enum(['forgot']).optional(),
})

const Screen = () => {
  const { next, note, step, method, view } = Route.useSearch()
  const resume = step === 'enrol' ? ({ step: 'enrol' } as const) : step === 'second-factor' ? ({ step: 'second-factor', method: method ?? 'sms' } as const) : undefined
  return <SignIn next={next} note={note} resume={resume} start={view} />
}

export const Route = createFileRoute('/_auth/sign-in')({ validateSearch: search, component: Screen })
