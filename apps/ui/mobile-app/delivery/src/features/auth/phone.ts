// The Delivery API takes a number in international form, `+` and 7 to 15 digits (docs/api/DELIVERY.md §4); the API checks it again.
const e164 = /^\+[1-9]\d{6,14}$/

const digits = (value: string): string => value.replaceAll(/\D/g, '')

/** The number as the API wants it, or null when it cannot be one. One leading 0 of the national number is the trunk prefix, not part of it. */
export const toE164 = (countryCode: string, national: string): string | null => {
  if (!digits(countryCode)) return null
  const number = `+${digits(countryCode)}${digits(national).replace(/^0/, '')}`
  return e164.test(number) ? number : null
}

// The countries a rider's number can start with, by ISO 3166 code, with their calling codes (docs/mobile-app/delivery/FIRST-RELEASE.md §2).
// The names are in messages/ (`countries.<ISO>`). The store's own country is preselected when it is here.
export const countries = [
  { iso: 'AE', dial: '971' }, { iso: 'AU', dial: '61' }, { iso: 'BD', dial: '880' }, { iso: 'BH', dial: '973' }, { iso: 'BR', dial: '55' }, { iso: 'CA', dial: '1' }, { iso: 'CN', dial: '86' }, { iso: 'DE', dial: '49' },
  { iso: 'EG', dial: '20' }, { iso: 'ES', dial: '34' }, { iso: 'FR', dial: '33' }, { iso: 'GB', dial: '44' }, { iso: 'ID', dial: '62' }, { iso: 'IE', dial: '353' }, { iso: 'IN', dial: '91' }, { iso: 'IT', dial: '39' },
  { iso: 'JP', dial: '81' }, { iso: 'KE', dial: '254' }, { iso: 'KR', dial: '82' }, { iso: 'KW', dial: '965' }, { iso: 'LK', dial: '94' }, { iso: 'MX', dial: '52' }, { iso: 'MY', dial: '60' }, { iso: 'NG', dial: '234' },
  { iso: 'NL', dial: '31' }, { iso: 'NP', dial: '977' }, { iso: 'NZ', dial: '64' }, { iso: 'OM', dial: '968' }, { iso: 'PH', dial: '63' }, { iso: 'PK', dial: '92' }, { iso: 'QA', dial: '974' }, { iso: 'SA', dial: '966' },
  { iso: 'SG', dial: '65' }, { iso: 'TH', dial: '66' }, { iso: 'US', dial: '1' }, { iso: 'VN', dial: '84' }, { iso: 'ZA', dial: '27' },
] as const

export type CountryIso = (typeof countries)[number]['iso']

/** The country in the list, or null for one that is not. */
export const countryOf = (iso: string | null): CountryIso | null => countries.find((country) => country.iso === iso)?.iso ?? null

export const dialOf = (iso: CountryIso): string => countries.find((country) => country.iso === iso)?.dial ?? ''

/** The flag emoji for an ISO 3166 code: its two letters as regional indicator symbols. */
export const flagOf = (iso: string): string => String.fromCodePoint(...[...iso.toUpperCase()].map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65))
