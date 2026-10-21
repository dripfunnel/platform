import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { ConfirmEmail } from '../../features/auth/ConfirmEmail'

const Screen = () => <ConfirmEmail token={Route.useSearch().token} />

export const Route = createFileRoute('/_auth/confirm-email')({ validateSearch: z.object({ token: z.string().optional() }), component: Screen })
