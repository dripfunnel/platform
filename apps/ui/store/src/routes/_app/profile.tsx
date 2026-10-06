import { createFileRoute } from '@tanstack/react-router'
import { ProfileScreen } from '../../features/profile/ProfileScreen'

export const Route = createFileRoute('/_app/profile')({ component: ProfileScreen })
