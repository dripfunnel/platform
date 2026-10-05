import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { SignIn } from '../../features/sign-in/SignIn'

// `next` is the page to come back to (ACCESS.md §4); SUI 3 builds the screen that reads it.
export const Route = createFileRoute('/_auth/sign-in')({ validateSearch: z.object({ next: z.string().optional() }), component: SignIn })
