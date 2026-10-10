import { optionalParam } from '@dripfunnel/shared/search'
import { z } from 'zod'
import { stripeAnswers, stripeKeyPattern } from './stripeBack'

/** The tabs built so far, in PortalSettings' order; each card adds its own (FIRST-RELEASE §15). */
export const settingsTabs = ['store', 'people', 'supplier', 'payments', 'shipping', 'warehouse', 'tax', 'markets', 'catalogue', 'customers', 'developers'] as const
export type SettingsTab = (typeof settingsTabs)[number]

export const settingsSearch = z.looseObject({
  tab: optionalParam(z.enum(settingsTabs)),
  stripe: optionalParam(z.enum(stripeAnswers)),
  key: optionalParam(z.string().regex(stripeKeyPattern)),
})
