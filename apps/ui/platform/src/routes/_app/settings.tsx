import { createFileRoute } from '@tanstack/react-router'
import { SettingsPlaceholder } from '../../features/settings/SettingsPlaceholder'

export const Route = createFileRoute('/_app/settings')({ component: SettingsPlaceholder })
