import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { SignIn } from '../../features/auth/SignIn'

// `next` is where to go after sign-in, checked same-origin in api/auth.ts; `outcome` is the Worker's.
export const Route = createFileRoute('/_auth/sign-in')({
  validateSearch: z.looseObject({ next: z.string().optional(), outcome: z.string().optional(), state: z.string().optional() }),
  component: () => <SignIn search={Route.useSearch()} />,
})
