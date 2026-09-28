import { createFileRoute } from '@tanstack/react-router'
import { SignIn } from '../../features/sign-in/SignIn'

export const Route = createFileRoute('/_auth/sign-in')({ component: SignIn })
