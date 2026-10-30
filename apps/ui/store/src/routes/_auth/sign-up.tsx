import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { SignUp } from '../../features/auth/SignUp'
import { googleOutcomes } from '../../features/auth/refusals'

// Back from Google (ACCESS.md §2): at the store step with the sign-up's cookie, or with why not.
const search = z.object({
  step: z.enum(['store']).optional(),
  outcome: z.enum(googleOutcomes).optional(),
})

const Screen = () => {
  const { step, outcome } = Route.useSearch()
  return <SignUp fromGoogle={step === 'store'} google={outcome} />
}

export const Route = createFileRoute('/_auth/sign-up')({ validateSearch: search, component: Screen })
