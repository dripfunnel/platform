import { formatCountry, locale } from '../../messages'
import { countryCodes } from './partnerCurrencies'

// The countries DripFunnel sells in (#221), from the one table pinned to the API's core/countries.ts.
export const partnerCountries: readonly { code: string; name: string }[] = countryCodes
  .map((code) => ({ code, name: formatCountry(code) }))
  .sort((a, b) => a.name.localeCompare(b.name, locale))
