import { optionalParam } from '@dripfunnel/shared/search'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { loadSettings } from '../../api/settings'
import { SettingsLoading } from '../../features/settings/Settings'
import { settingsTabs } from '../../features/settings/settingsHarness'
import { SettingsRouteError, SettingsScreen } from '../../features/settings/SettingsScreen'

export const Route = createFileRoute('/_app/settings')({
  validateSearch: z.looseObject({ tab: optionalParam(z.enum(settingsTabs)) }),
  loader: () => loadSettings(),
  pendingComponent: SettingsLoading,
  errorComponent: SettingsRouteError,
  component: SettingsScreen,
})
