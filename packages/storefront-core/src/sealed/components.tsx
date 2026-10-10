'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { readConsent, writeConsent, type ConsentChoice } from '../platform/consent/consent'
import type { Translate } from '../platform/i18n/i18n'
import { formatMoney, type Money } from '../pricing/money'
import { focusedElement, showInTopLayer } from './element'
import { Sealed } from './Sealed'

// The sealed components (storefront ARCHITECTURE §2.1, §3.5; DESIGN §3). A theme places them and styles
// them through `className`, the --df-* custom properties and their ::part names, never their insides.

type Styled = { className?: string }

export type PriceProps = Styled & { money: Money; compareAt?: Money | null; includesTax: boolean; locale: string; t: Translate }

/** The price with its tax label; a compare-at price only as the engine returns it, in the same currency. Parts: amount, was, tax. */
export const Price = ({ money, compareAt, includesTax, locale, t, className }: PriceProps) => (
  <Sealed part="price" className={className}>
    <span className="price">
      <span part="amount">{formatMoney(money, locale)}</span>
      {compareAt && compareAt.currency === money.currency && BigInt(compareAt.amount) > BigInt(money.amount) ? <s part="was">{t('price.was', { price: formatMoney(compareAt, locale) })}</s> : null}{' '}
      <span part="tax">{t(includesTax ? 'price.inclTax' : 'price.plusTax')}</span>
    </span>
  </Sealed>
)

/** In the top layer at the top of the page, its height held in the page. Part: banner. */
export const PreviewBanner = ({ t, className }: Styled & { t: Translate }) => {
  const banner = useRef<HTMLParagraphElement>(null)
  useLayoutEffect(() => showInTopLayer(banner.current))
  return (
    <Sealed part="preview" className={className} reserve>
      <p ref={banner} part="banner" popover="manual" role="status">
        {t('preview.banner')}
      </p>
    </Sealed>
  )
}

/** Part: line. */
export const PoweredBy = ({ brand, t, className }: Styled & { brand: string | null; t: Translate }) =>
  brand ? (
    <Sealed part="powered" className={className}>
      <span part="line">{t('powered.by', { brand })}</span>
    </Sealed>
  ) : null

export type LegalNotice = { title: string; body: string }

/** The store's legal and compliance notices for its markets, as the Shop API gives them. Parts: section, title, body. */
export const LegalNotices = ({ notices, t, className }: Styled & { notices: readonly LegalNotice[]; t: Translate }) =>
  notices.length ? (
    <Sealed part="legal" className={className}>
      <section part="section" aria-label={t('legal.title')}>
        {notices.map((n, i) => (
          // Two markets may share a title, and a notice must never be dropped.
          <div key={i}>
            <h2 part="title">{n.title}</h2>
            <p part="body">{n.body}</p>
          </div>
        ))}
      </section>
    </Sealed>
  ) : null

export type Crumb = { label: string; href: string }

/** The trail to this page, its last crumb the page itself (ARCHITECTURE §8). Parts: list, item, link, current. */
export const Breadcrumbs = ({ crumbs, t, className }: Styled & { crumbs: readonly Crumb[]; t: Translate }) =>
  crumbs.length ? (
    <Sealed part="breadcrumbs" className={className}>
      <nav aria-label={t('breadcrumbs.label')}>
        <ol part="list">
          {crumbs.map((c, i) => (
            <li key={c.href} part="item">
              {i === crumbs.length - 1 ? (
                <span part="current" aria-current="page">
                  {c.label}
                </span>
              ) : (
                <a part="link" href={c.href}>
                  {c.label}
                </a>
              )}
            </li>
          ))}
        </ol>
      </nav>
    </Sealed>
  ) : null

const reopeners = new Set<() => void>()

/** Opens the consent banner again with the saved choice, so a shopper can change or withdraw it. */
export const openConsentSettings = () => reopeners.forEach((open) => open())

/** The "Cookie settings" button a theme places in its footer; it reopens the banner. Part: button. */
export const ConsentSettingsButton = ({ t, className }: Styled & { t: Translate }) => (
  <Sealed part="consent-settings" className={className}>
    <button type="button" part="button" onClick={openConsentSettings}>
      {t('consent.settings')}
    </button>
  </Sealed>
)

/**
 * Asks before any analytics or marketing cookie and remembers the answer (storefront ARCHITECTURE §8), in
 * the top layer at the foot of the page. Not modal, so it takes no focus until the shopper opens a step.
 * Parts: banner, title, body, choice, button.
 */
export const ConsentBanner = ({ t, onChange, className }: Styled & { t: Translate; onChange?: (choice: ConsentChoice) => void }) => {
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState(false)
  const [draft, setDraft] = useState({ analytics: false, marketing: false })
  const banner = useRef<HTMLElement>(null)
  const firstChoice = useRef<HTMLInputElement>(null)
  const firstButton = useRef<HTMLButtonElement>(null)
  const openedFrom = useRef<HTMLElement | null>(null)
  useEffect(() => {
    setOpen(readConsent() === null)
    const reopen = () => {
      const focused = focusedElement(document)
      openedFrom.current = focused instanceof HTMLElement ? focused : null
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
  useLayoutEffect(() => showInTopLayer(banner.current))
  useEffect(() => {
    if (open && custom) firstChoice.current?.focus()
  }, [open, custom])
  // Always rendered, marked closed once answered, so a static page still carries it.
  if (!open) return <Sealed part="consent" className={className} shown={false} />
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
    <Sealed part="consent" className={className}>
      <section ref={banner} part="banner" popover="manual" role="region" aria-labelledby="df-consent-title">
        <h2 id="df-consent-title" part="title">
          {t('consent.title')}
        </h2>
        <p part="body">{t('consent.body')}</p>
        {custom ? (
          <>
            {(['analytics', 'marketing'] as const).map((k, i) => (
              <label key={k} part="choice">
                <input ref={i === 0 ? firstChoice : undefined} type="checkbox" checked={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.checked })} /> {t(k === 'analytics' ? 'consent.analytics' : 'consent.marketing')}
              </label>
            ))}
            <div className="actions">
              <button type="button" part="button" onClick={() => decide(draft)}>
                {t('consent.save')}
              </button>
              <button type="button" part="button" onClick={back}>
                {t('consent.back')}
              </button>
            </div>
          </>
        ) : (
          <div className="actions">
            <button ref={firstButton} type="button" part="button" onClick={() => decide({ analytics: false, marketing: false })}>
              {t('consent.rejectAll')}
            </button>
            <button type="button" part="button" onClick={() => setCustom(true)}>
              {t('consent.customize')}
            </button>
            <button type="button" part="button" onClick={() => decide({ analytics: true, marketing: true })}>
              {t('consent.acceptAll')}
            </button>
          </div>
        )}
      </section>
    </Sealed>
  )
}
