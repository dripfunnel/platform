import type { Offers } from '../../api/markets'

/** What the shopper picked; a field that is null was never picked, so the API's default for the store holds. */
export type Choice = { language: string | null; currency: string | null }

export const noChoice: Choice = { language: null, currency: null }

const base = (language: string): string => language.toLowerCase().split('-')[0] ?? ''

/** The phone's languages, most wanted first: its own list where Intl has one, else its one locale. */
export const phoneLanguages = (): string[] => {
  try {
    return [Intl.DateTimeFormat().resolvedOptions().locale]
  } catch {
    return []
  }
}

/** The store's language the phone speaks (an exact code first, then the same language in another region), else the store's main one (first offered). */
export const defaultLanguage = (offers: Offers, phone: string[]): string => {
  for (const wanted of phone) {
    const exact = offers.languages.find((offered) => offered.toLowerCase() === wanted.toLowerCase())
    const sameLanguage = offers.languages.find((offered) => base(offered) === base(wanted))
    const found = exact ?? sameLanguage
    if (found) return found
  }
  return offers.languages[0] ?? ''
}

/** What goes out with every request: a saved choice the store still offers, else the phone's language; the currency only once picked, so the store's own default prices apply until then. With no offers known, what was saved goes as it is and the API falls back for a value the store lacks. */
export const resolveChoice = (offers: Offers | null, saved: Choice, phone: string[]): Choice =>
  offers
    ? {
        language: saved.language && offers.languages.includes(saved.language) ? saved.language : defaultLanguage(offers, phone),
        currency: saved.currency && offers.currencies.includes(saved.currency) ? saved.currency : null,
      }
    : saved

/** The Shop API reads the language and currency as `X-Shop-Language` and `X-Shop-Currency`, each only once there is one (the website's client sends the same). */
export const marketHeaders = ({ language, currency }: Choice): Record<string, string> => ({
  ...(language ? { 'x-shop-language': language } : {}),
  ...(currency ? { 'x-shop-currency': currency } : {}),
})
