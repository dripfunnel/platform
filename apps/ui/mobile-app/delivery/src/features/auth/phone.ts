// The Delivery API takes a number in international form, `+` and 7 to 15 digits (docs/api/DELIVERY.md §4); the API checks it again.
const e164 = /^\+[1-9]\d{6,14}$/

const digits = (value: string): string => value.replaceAll(/\D/g, '')

/** The number as the API wants it, or null when it cannot be one. One leading 0 of the national number is the trunk prefix, not part of it. */
export const toE164 = (countryCode: string, national: string): string | null => {
  if (!digits(countryCode)) return null
  const number = `+${digits(countryCode)}${digits(national).replace(/^0/, '')}`
  return e164.test(number) ? number : null
}

// Calling codes by ISO 3166 country, to preselect the store's own (docs/mobile-app/delivery/FIRST-RELEASE.md §2). A country not here leaves the code to type.
const callingCodes: Readonly<Record<string, string>> = {
  AE: '971', AU: '61', BD: '880', BH: '973', BR: '55', CA: '1', CN: '86', DE: '49', EG: '20', ES: '34', FR: '33', GB: '44', ID: '62', IE: '353', IN: '91', IT: '39', JP: '81', KE: '254', KR: '82', KW: '965', LK: '94', MX: '52',
  MY: '60', NG: '234', NL: '31', NP: '977', NZ: '64', OM: '968', PH: '63', PK: '92', QA: '974', SA: '966', SG: '65', TH: '66', US: '1', VN: '84', ZA: '27',
}

export const callingCodeOf = (country: string | null): string => (country ? (callingCodes[country] ?? '') : '')
