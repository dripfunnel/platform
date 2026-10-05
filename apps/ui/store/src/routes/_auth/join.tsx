import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { Invitation } from '../../features/auth/Invitation'

const Screen = () => <Invitation token={Route.useSearch().token} path="join" />

export const Route = createFileRoute('/_auth/join')({ validateSearch: z.object({ token: z.string().optional() }), component: Screen })
