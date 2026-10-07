import { useEffect, useState } from 'react'
import type { Translate } from './i18n/i18n'
import { formatMoney, type ShopMoney } from './pricing/money'
import { readConsent, writeConsent, type ConsentChoice } from './consent/consent'

// The required components (storefront ARCHITECTURE §2.1, DESIGN §3): a theme styles them through
// their class names and never removes or rewords them. Each carries data-df-required, which the
// contract tests (./testing) look for.

export type PriceProps = { money: ShopMoney; compareAt?: ShopMoney | null; includesTax: boolean; locale: string; t: Translate }

/** The price with its tax label; a compare-at price only as the engine returns it. */
export const Price = ({ money, compareAt, includesTax, locale, t }: PriceProps) => (
  <span className="df-price" data-df-required="price">
    <span className="df-price-amount">{formatMoney(money, locale)}</span>
    {compareAt && BigInt(compareAt.amount) > BigInt(money.amount) ? <s className="df-price-was">{t('price.was', { price: formatMoney(compareAt, locale) })}</s> : null}{' '}
    <span className="df-price-tax">{t(includesTax ? 'price.inclTax' : 'price.plusTax')}</span>
  </span>
)

export const PreviewBanner = ({ t }: { t: Translate }) => (
  <p className="df-preview" data-df-required="preview" role="status">
    {t('preview.banner')}
  </p>
)

export const PoweredBy = ({ brand, t }: { brand: string | null; t: Translate }) =>
  brand ? (
    <span className="df-powered" data-df-required="powered">
      {t('powered.by', { brand })}
    </span>
  ) : null

export type LegalNotice = { title: string; body: string }

/** The store's legal and compliance notices for its markets, as the Shop API gives them. */
export const LegalNotices = ({ notices, t }: { notices: readonly LegalNotice[]; t: Translate }) =>
  notices.length ? (
    <section className="df-legal" data-df-required="legal" aria-label={t('legal.title')}>
      {notices.map((n) => (
        <div key={n.title}>
          <h2>{n.title}</h2>
          <p>{n.body}</p>
        </div>
      ))}
    </section>
  ) : null

/** Asks once, before any analytics or marketing cookie, and remembers the answer (storefront ARCHITECTURE §8). */
export const ConsentBanner = ({ t, onChange }: { t: Translate; onChange?: (choice: ConsentChoice) => void }) => {
  const [choice, setChoice] = useState<ConsentChoice | null | 'unread'>('unread')
  const [custom, setCustom] = useState(false)
  const [draft, setDraft] = useState({ analytics: false, marketing: false })
  useEffect(() => setChoice(readConsent()), [])
  if (choice !== null) return null
  const decide = (c: Omit<ConsentChoice, 'at'>) => {
    const saved = writeConsent(c)
    setChoice(saved)
    onChange?.(saved)
  }
  return (
    <section className="df-consent" data-df-required="consent" role="dialog" aria-labelledby="df-consent-title">
      <h2 id="df-consent-title">{t('consent.title')}</h2>
      <p>{t('consent.body')}</p>
      {custom ? (
        <>
          {(['analytics', 'marketing'] as const).map((k) => (
            <label key={k}>
              <input type="checkbox" checked={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.checked })} /> {t(k === 'analytics' ? 'consent.analytics' : 'consent.marketing')}
            </label>
          ))}
          <button type="button" onClick={() => decide(draft)}>
            {t('consent.save')}
          </button>
        </>
      ) : (
        <>
          <button type="button" onClick={() => decide({ analytics: false, marketing: false })}>
            {t('consent.rejectAll')}
          </button>
          <button type="button" onClick={() => setCustom(true)}>
            {t('consent.customize')}
          </button>
          <button type="button" onClick={() => decide({ analytics: true, marketing: true })}>
            {t('consent.acceptAll')}
          </button>
        </>
      )}
    </section>
  )
}
