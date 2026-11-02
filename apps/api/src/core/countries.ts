// The countries a store may be created in, with the currency its plan is charged in (ISO 3166-1
// alpha-2 → ISO 4217). Names come from Intl, in English, as the console words them.

const currencyByCountry: Readonly<Record<string, string>> = {
  AE: 'AED', AT: 'EUR', AU: 'AUD', BE: 'EUR', BR: 'BRL', CA: 'CAD', CH: 'CHF', DE: 'EUR', DK: 'DKK', ES: 'EUR',
  FI: 'EUR', FR: 'EUR', GB: 'GBP', IE: 'EUR', IN: 'INR', IT: 'EUR', JP: 'JPY', MX: 'MXN', NL: 'EUR', NO: 'NOK',
  NZ: 'NZD', PL: 'PLN', PT: 'EUR', SA: 'SAR', SE: 'SEK', SG: 'SGD', US: 'USD', ZA: 'ZAR',
}

// International dialling codes (ITU-T E.164), for the same countries.
const dialCodeByCountry: Readonly<Record<string, string>> = {
  AE: '971', AT: '43', AU: '61', BE: '32', BR: '55', CA: '1', CH: '41', DE: '49', DK: '45', ES: '34',
  FI: '358', FR: '33', GB: '44', IE: '353', IN: '91', IT: '39', JP: '81', MX: '52', NL: '31', NO: '47',
  NZ: '64', PL: '48', PT: '351', SA: '966', SE: '46', SG: '65', US: '1', ZA: '27',
}

/** The digits a number in `code` starts with after the `+` (India → `91`); null for a country a store can't be made in. */
export const dialCodeOf = (code: string): string | null => (Object.hasOwn(dialCodeByCountry, code) ? (dialCodeByCountry[code] ?? null) : null)

const names = new Intl.DisplayNames(['en'], { type: 'region' })

export interface Country {
  code: string
  name: string
  currency: string
}

export const countryOf = (code: string): Country | null => {
  // Own keys only: `constructor` and the like would reach Intl.DisplayNames and throw.
  const currency = Object.hasOwn(currencyByCountry, code) ? currencyByCountry[code] : undefined
  return currency ? { code, name: names.of(code) ?? code, currency } : null
}

/** The currencies of the countries above: what a partner's contract may name. */
export const sellingCurrencies: readonly string[] = [...new Set(Object.values(currencyByCountry))].sort()

/** Every country whose currency is one of `currencies`, by name. */
export const countriesIn = (currencies: ReadonlySet<string>): Country[] =>
  Object.keys(currencyByCountry)
    .map((code) => countryOf(code))
    .filter((c): c is Country => c !== null && currencies.has(c.currency))
    .sort((a, b) => a.name.localeCompare(b.name, 'en'))

const anyRegion = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' })

/** The European Union's 27 member states. */
export const euCountries: ReadonlySet<string> = new Set(['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE'])

/** Any ISO 3166-1 alpha-2 country the runtime names, for where a market sells (wider than where a store is made). */
export const isCountry = (code: string): boolean => /^[A-Z]{2}$/.test(code) && anyRegion.of(code) !== undefined
