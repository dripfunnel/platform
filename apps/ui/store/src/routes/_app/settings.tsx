import { optionalParam } from '@dripfunnel/shared/search'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { SettingsPage } from '../../features/settings/SettingsPage'

export const Route = createFileRoute('/_app/settings')({
  validateSearch: z.looseObject({ tab: optionalParam(z.enum(['store', 'people', 'supplier', 'warehouse', 'tax'])) }),
  component: SettingsPage,
})
