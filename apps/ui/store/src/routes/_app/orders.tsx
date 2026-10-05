import { createFileRoute } from '@tanstack/react-router'
import { ScreenPlaceholder } from '../../features/shell/ScreenPlaceholder'

export const Route = createFileRoute('/_app/orders')({ component: () => <ScreenPlaceholder screen="orders" /> })
