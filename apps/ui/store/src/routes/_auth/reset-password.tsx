import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { ResetPassword } from '../../features/auth/ResetPassword'

const Screen = () => <ResetPassword token={Route.useSearch().token} />

export const Route = createFileRoute('/_auth/reset-password')({ validateSearch: z.object({ token: z.string().optional() }), component: Screen })
