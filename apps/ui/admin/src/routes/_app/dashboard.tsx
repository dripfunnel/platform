import { createFileRoute } from '@tanstack/react-router'
import { Dashboard } from '../../features/dashboard/Dashboard'

export const Route = createFileRoute('/_app/dashboard')({ component: Dashboard })
