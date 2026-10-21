import { regionName } from '../../format'
import { locale } from '../../messages'
import type { PickerOption } from './PickerField'

// The countries a market or a location can name: the ones stores sell to most first, then every other by name.
export const featuredCountries = ['US', 'CA', 'GB', 'DE', 'FR', 'NL', 'AT', 'IT', 'ES', 'IN', 'AE', 'AU', 'JP']
const every =
  'AD AE AF AG AL AM AO AR AT AU AZ BA BB BD BE BG BH BN BO BR BS BT BW BY BZ CA CH CL CN CO CR CY CZ DE DK DO DZ EC EE EG ES ET FI FJ FR GB GE GH GR GT HK HN HR HU ID IE IL IN IQ IS IT JM JO JP KE KH KR KW KZ LA LB LK LT LU LV MA MC MD ME MK MM MN MO MT MU MV MX MY NA NG NI NL NO NP NZ OM PA PE PH PK PL PR PT PY QA RO RS RW SA SE SG SI SK SN SV TH TN TR TT TW TZ UA UG US UY UZ VN ZA ZM'.split(' ')

export const countryCodes: readonly string[] = [...featuredCountries, ...every.filter((code) => !featuredCountries.includes(code)).sort((a, b) => regionName(a, locale).localeCompare(regionName(b, locale), locale))]

export const countryOptions = (): PickerOption[] => countryCodes.map((code) => ({ value: code, label: regionName(code, locale) }))
