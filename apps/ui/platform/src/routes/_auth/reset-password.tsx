import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { ResetPassword } from '../../features/auth/ResetPassword'

// The link in the reset email (apps/api src/saas/email/compose.ts); the token is checked on Save.
export const Route = createFileRoute('/_auth/reset-password')({
  validateSearch: z.looseObject({ token: z.string().optional(), state: z.string().optional() }),
  component: () => <ResetPassword search={Route.useSearch()} />,
})
