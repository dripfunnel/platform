import { isApiError } from '../graphql'
import { t, tryT } from './index'

/** Where an error happened, so one code can read differently: a wrong password at sign-in is not a wrong current password. */
export type ErrorContext = 'signIn' | 'password' | 'profile' | 'code' | 'products' | 'productKind' | 'productFile' | 'collections' | 'filters' | 'menus' | 'sizeCharts' | 'settingsStore' | 'closeStore' | 'settingsPeople' | 'settingsSuppliers' | 'settingsWarehouse' | 'settingsTax' | 'settingsMarkets' | 'settingsCatalogue' | 'settingsPayments' | 'settingsShipping' | 'settingsAccounts' | 'customers' | 'orders' | 'imports' | 'supplierTeam' | 'offers' | 'carts' | 'reports' | 'settingsDevelopers' | 'settingsApps' | 'settingsSupport' | 'support'

// Errors are handled by code, never by the API's words (ui/README.md §3): the context's wording first, then the
// code's own, then one message for anything else. Facts the refusal carries (`minutes`, `triesLeft`) fill the words,
// and a refusal that says how many tries are left uses the `_TRIES` wording where there is one.
export const errorMessage = (error: unknown, context?: ErrorContext): string => {
  if (!isApiError(error)) return t('errors.generic')
  const values: Record<string, string | number> = {}
  for (const [name, value] of Object.entries(error.details)) if (typeof value === 'string' || typeof value === 'number') values[name] = value
  const keys = [context ? `errors.${context}.${error.code}` : null, `errors.${error.code}`].filter((key): key is string => key !== null)
  const withTries = typeof values.triesLeft === 'number' ? keys.map((key) => `${key}_TRIES`) : []
  for (const key of [...withTries, ...keys]) {
    const found = tryT(key, values)
    if (found !== undefined) return found
  }
  return t('errors.generic')
}
