import { createFileRoute } from '@tanstack/react-router'
import { ScreenPlaceholder } from '../../features/shell/ScreenPlaceholder'

export const Route = createFileRoute('/_app/plans')({ component: () => <ScreenPlaceholder screen="plans" /> })
