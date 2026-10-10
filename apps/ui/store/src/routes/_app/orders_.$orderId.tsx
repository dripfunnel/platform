import { createFileRoute } from '@tanstack/react-router'
import { ScreenPlaceholder } from '../../features/shell/ScreenPlaceholder'

export const Route = createFileRoute('/_app/orders_/$orderId')({ component: () => <ScreenPlaceholder screen="orders" /> })
