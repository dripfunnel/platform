import { createFileRoute } from '@tanstack/react-router'
import { ScreenPlaceholder } from '../../features/shell/ScreenPlaceholder'

export const Route = createFileRoute('/_app/offers')({ component: () => <ScreenPlaceholder screen="offers" /> })
