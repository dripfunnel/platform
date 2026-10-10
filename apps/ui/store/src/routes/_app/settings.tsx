import { createFileRoute } from '@tanstack/react-router'
import { SettingsPage } from '../../features/settings/SettingsPage'
import { settingsSearch } from '../../features/settings/settingsSearch'

export const Route = createFileRoute('/_app/settings')({
  validateSearch: settingsSearch,
  component: SettingsPage,
})
