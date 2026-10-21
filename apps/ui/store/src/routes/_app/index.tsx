import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_app/')({ beforeLoad: ({ search }) => redirect({ to: '/home', search }) })
