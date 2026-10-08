'use client'

import { useEffect, useRef, useState } from 'react'
import type { Translate } from './i18n/i18n'
import { formatMoney, type ShopMoney } from './pricing/money'
import { readConsent, writeConsent, type ConsentChoice } from './consent/consent'

// The required components (storefront ARCHITECTURE §2.1, DESIGN §3), marked data-df-required for
// ./testing. Themes style them by class name until #481 seals them in a closed Shadow DOM.

export type PriceProps = { money: ShopMoney; compareAt?: ShopMoney | null; includesTax: boolean; locale: string; t: Translate }

/** The price with its tax label; a compare-at price only as the engine returns it, in the same currency. */
export const Price = ({ money, compareAt, includesTax, locale, t }: PriceProps) => (
  <span className="df-price" data-df-required="price">
    <span className="df-price-amount">{formatMoney(money, locale)}</span>
    {compareAt && compareAt.currency === money.currency && BigInt(compareAt.amount) > BigInt(money.amount) ? <s className="df-price-was">{t('price.was', { price: formatMoney(compareAt, locale) })}</s> : null}{' '}
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
      {notices.map((n, i) => (
        // Two markets may share a title, and a notice must never be dropped.
        <div key={i}>
          <h2>{n.title}</h2>
          <p>{n.body}</p>
        </div>
      ))}
    </section>
  ) : null

const reopeners = new Set<() => void>()

/** Opens the consent banner again with the saved choice, so a shopper can change or withdraw it. */
export const openConsentSettings = () => reopeners.forEach((open) => open())

/** The "Cookie settings" link a theme places in its footer; it reopens the banner. */
export const ConsentSettingsButton = ({ t, className }: { t: Translate; className?: string }) => (
  <button type="button" className={className ?? 'df-consent-settings'} data-df-required="consent-settings" onClick={openConsentSettings}>
    {t('consent.settings')}
  </button>
)

/**
 * Asks before any analytics or marketing cookie and remembers the answer (storefront ARCHITECTURE
 * §8). Not modal, so it takes no focus on its own; focus moves only when the shopper opens a step.
 */
export const ConsentBanner = ({ t, onChange }: { t: Translate; onChange?: (choice: ConsentChoice) => void }) => {
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState(false)
  const [draft, setDraft] = useState({ analytics: false, marketing: false })
  const firstChoice = useRef<HTMLInputElement>(null)
  const firstButton = useRef<HTMLButtonElement>(null)
  const openedFrom = useRef<HTMLElement | null>(null)
  useEffect(() => {
    setOpen(readConsent() === null)
    const reopen = () => {
      openedFrom.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      const saved = readConsent()
      setDraft({ analytics: saved?.analytics ?? false, marketing: saved?.marketing ?? false })
      setCustom(saved !== null)
      setOpen(true)
    }
    reopeners.add(reopen)
    return () => {
      reopeners.delete(reopen)
    }
  }, [])
  useEffect(() => {
    if (open && custom) firstChoice.current?.focus()
  }, [open, custom])
  // Always rendered, hidden when closed, so a static page still carries the required part.
  if (!open) return <section className="df-consent" data-df-required="consent" hidden />
  const decide = (c: Omit<ConsentChoice, 'at'>) => {
    const saved = writeConsent(c)
    setOpen(false)
    setCustom(false)
    onChange?.(saved)
    openedFrom.current?.focus()
    openedFrom.current = null
  }
  const back = () => {
    setCustom(false)
    requestAnimationFrame(() => firstButton.current?.focus())
  }
  return (
    <section className="df-consent" data-df-required="consent" role="region" aria-labelledby="df-consent-title">
      <h2 id="df-consent-title">{t('consent.title')}</h2>
      <p>{t('consent.body')}</p>
      {custom ? (
        <>
          {(['analytics', 'marketing'] as const).map((k, i) => (
            <label key={k}>
              <input ref={i === 0 ? firstChoice : undefined} type="checkbox" checked={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.checked })} /> {t(k === 'analytics' ? 'consent.analytics' : 'consent.marketing')}
            </label>
          ))}
          <button type="button" onClick={() => decide(draft)}>
            {t('consent.save')}
          </button>
          <button type="button" onClick={back}>
            {t('consent.back')}
          </button>
        </>
      ) : (
        <>
          <button ref={firstButton} type="button" onClick={() => decide({ analytics: false, marketing: false })}>
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
