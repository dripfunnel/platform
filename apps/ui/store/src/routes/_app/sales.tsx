import { createFileRoute } from '@tanstack/react-router'
import { SalesPage } from '../../features/sales/SalesPage'

export const Route = createFileRoute('/_app/sales')({ component: SalesPage })
