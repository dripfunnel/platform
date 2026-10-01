import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { ScreenPlaceholder } from '../../features/shell/ScreenPlaceholder'

// ?person= is the user menu's My activity filter (FIRST-RELEASE.md §13); the screen is a later card.
export const Route = createFileRoute('/_app/activity')({
  validateSearch: z.object({ person: z.string().optional() }),
  component: () => <ScreenPlaceholder screen="activity" />,
})
