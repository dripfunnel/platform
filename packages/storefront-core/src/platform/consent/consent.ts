export type ConsentChoice = { analytics: boolean; marketing: boolean; at: string }

const key = 'df-consent-v1'

/** The shopper's saved choice, or null when they haven't chosen (or storage is unavailable). */
export const readConsent = (): ConsentChoice | null => {
  try {
    const raw = globalThis.localStorage?.getItem(key)
    if (!raw) return null
    const v = JSON.parse(raw) as Partial<ConsentChoice>
    return typeof v.analytics === 'boolean' && typeof v.marketing === 'boolean' && typeof v.at === 'string' ? { analytics: v.analytics, marketing: v.marketing, at: v.at } : null
  } catch {
    return null
  }
}

export const writeConsent = (c: Omit<ConsentChoice, 'at'>, now = new Date()): ConsentChoice => {
  const saved = { analytics: c.analytics, marketing: c.marketing, at: now.toISOString() }
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(saved))
  } catch {
    // Unavailable storage: the choice holds for this page, and the banner asks again next time.
  }
  return saved
}
