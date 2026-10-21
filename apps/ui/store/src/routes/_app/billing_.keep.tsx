import { createFileRoute } from '@tanstack/react-router'
import { KeepPage } from '../../features/billing/KeepPage'

export const Route = createFileRoute('/_app/billing_/keep')({ component: KeepPage })
