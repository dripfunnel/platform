import { locale } from '../../messages'

// Each country DripFunnel sells in with its currency, as the API's core/countries.ts pairs them;
// a contract may name any of these currencies (`sellingCurrencies` there).
const countryCurrency: Readonly<Record<string, string>> = {
  AE: 'AED', AT: 'EUR', AU: 'AUD', BE: 'EUR', BR: 'BRL', CA: 'CAD', CH: 'CHF', DE: 'EUR', DK: 'DKK', ES: 'EUR',
  FI: 'EUR', FR: 'EUR', GB: 'GBP', IE: 'EUR', IN: 'INR', IT: 'EUR', JP: 'JPY', MX: 'MXN', NL: 'EUR', NO: 'NOK',
  NZ: 'NZD', PL: 'PLN', PT: 'EUR', SA: 'SAR', SE: 'SEK', SG: 'SGD', US: 'USD', ZA: 'ZAR',
}

const names = new Intl.DisplayNames([locale], { type: 'currency' })

export const currencyName = (code: string) => `${code} · ${names.of(code) ?? code}`

/** The countries DripFunnel sells in; the Create partner country list reads them from here. */
export const countryCodes: readonly string[] = Object.keys(countryCurrency)

export const partnerCurrencies: readonly string[] = [...new Set(Object.values(countryCurrency))].sort()

export const currencyOfCountry = (country: string): string | null => (Object.hasOwn(countryCurrency, country) ? (countryCurrency[country] ?? null) : null)
