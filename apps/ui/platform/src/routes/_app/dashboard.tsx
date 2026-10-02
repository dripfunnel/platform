import { createFileRoute } from '@tanstack/react-router'
import { HomeScreen } from '../../features/onboarding/HomeScreen'

// The checklist until Live, then the Dashboard (#114): FIRST-RELEASE.md §4.
export const Route = createFileRoute('/_app/dashboard')({ component: HomeScreen })
