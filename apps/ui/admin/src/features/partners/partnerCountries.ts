import { formatCountry, locale } from '../../messages'

// The countries DripFunnel sells in, as the API's core/countries.ts lists them (#221).
const codes = ['AE', 'AT', 'AU', 'BE', 'BR', 'CA', 'CH', 'DE', 'DK', 'ES', 'FI', 'FR', 'GB', 'IE', 'IN', 'IT', 'JP', 'MX', 'NL', 'NO', 'NZ', 'PL', 'PT', 'SA', 'SE', 'SG', 'US', 'ZA']

export const partnerCountries: readonly { code: string; name: string }[] = codes
  .map((code) => ({ code, name: formatCountry(code) }))
  .sort((a, b) => a.name.localeCompare(b.name, locale))
