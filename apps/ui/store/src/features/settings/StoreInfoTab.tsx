import { isApiError } from '@dripfunnel/shared/graphql'
import { ConfirmDialog, type ConfirmDialogProps } from '@dripfunnel/shared/ui'
import { useEffect, useId, useState } from 'react'
import { uploadPhoto } from '../../api/productEditor'
import { loadTranslationProgress, saveCurrencies, saveLanguages, saveStoreInfo, type StoreInfo, type StoreInfoInput, type StoreLocale } from '../../api/settings'
import { fill, formatCount, locale, messages } from '../../messages'
import { AssetImage } from '../common/AssetImage'

const words = messages.settings.store

type Ask = Omit<ConfirmDialogProps, 'open' | 'onCancel' | 'cancelLabel'>
type Currency = StoreLocale['currencies'][number]

/** Words the API's refusal codes come back as, with the plan's own figure where it gave one. */
export const refusalText = (error: unknown): string => {
  if (!isApiError(error)) return words.refused.other
  if (error.code === 'PLAN_LIMIT') {
    const limit = typeof error.details['limit'] === 'number' ? error.details['limit'] : null
    const key = error.details['key'] === 'languages' ? 'languages' : 'currencies'
    return limit === null ? words.refused.PLAN_LIMIT : fill(words.planLimit[key], { count: formatCount(limit) })
  }
  return (words.refused as Record<string, string>)[error.code] ?? words.refused.other
}

/** The card as typed: the next order number stays text until saved, so it can be cleared and retyped. */
export type StoreInfoForm = Omit<StoreInfoInput, 'nextOrderNumber'> & { nextOrderNumber: string }

export const formOf = (i: StoreInfo): StoreInfoForm => ({
  name: i.name,
  legalName: i.legalName ?? '',
  description: i.description ?? '',
  logoAssetId: i.logoAssetId,
  address: { street: i.address?.street ?? '', city: i.address?.city ?? '', postal: i.address?.postal ?? '', region: i.address?.region ?? '' },
  contactEmail: i.contactEmail ?? '',
  contactPhone: i.contactPhone ?? '',
  taxId: i.taxId ?? '',
  timeZone: i.timeZone,
  unitSystem: i.unitSystem,
  orderPrefix: i.orderPrefix ?? '',
  nextOrderNumber: i.nextOrderNumber,
})

/** The address and tax id fields' names in the home country's own words (SetStore, CATALOG fact 36). */
const labelsFor = (country: string | null) => (country === 'IN' ? words.country.IN : country === 'US' ? words.country.US : words.country.other)

/** Every zone the browser knows, each with its time now, the store's own first among them. */
const zones = (current: string): { value: string; label: string }[] => {
  const all = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [current]
  const now = new Date()
  return [...new Set([current, ...all])].map((z) => {
    const time = (() => {
      try {
        return new Intl.DateTimeFormat(locale, { timeZone: z, hour: '2-digit', minute: '2-digit' }).format(now)
      } catch {
        return ''
      }
    })()
    return { value: z, label: time ? `${z.replaceAll('_', ' ')} · ${time}` : z }
  })
}

const languageName = (code: string) => new Intl.DisplayNames([locale], { type: 'language' }).of(code) ?? code

/** What 100 of the pricing currency comes to in another, at the reference rate and its rounding (CATALOG O5). */
export const example = (from: string, to: string, rounding: Currency['rounding'], rates: StoreLocale['rates']): string | null => {
  const per = (c: string) => (c === 'EUR' ? 1 : Number(rates.find((r) => r.currency === c)?.perEuro ?? NaN))
  const raw = (100 / per(from)) * per(to)
  if (!Number.isFinite(raw)) return null
  const value = rounding === 'ends-99' ? Math.ceil(raw) - 0.01 : rounding === 'nearest' ? Math.round(raw) : raw
  const money = (c: string, v: number) => new Intl.NumberFormat(locale, { style: 'currency', currency: c }).format(v)
  return `${money(from, 100)} → ${money(to, value)}`
}

/** Currencies the store can add: the ones the reference rates cover, as converting needs a rate. */
const addableCurrencies = (l: StoreLocale, list: readonly Currency[]) => ['EUR', ...l.rates.map((r) => r.currency)].filter((c, i, all) => all.indexOf(c) === i && c !== l.pricingCurrency && !list.some((x) => x.code === c)).sort()

export interface StoreInfoTabProps {
  info: StoreInfo
  locale: StoreLocale
  canEdit: boolean
  onSaved: (toast: string) => void
}

/** SetStore: the store's details, then its currencies, then its languages, each card saving on its own. */
export const StoreInfoTab = ({ info, locale: loc, canEdit, onSaved }: StoreInfoTabProps) => {
  const id = useId()
  // What each card last saved: a save moves its own card's line only, so edits in the others stay as typed.
  const [saved, setSaved] = useState(() => formOf(info))
  const [savedCurrencies, setSavedCurrencies] = useState(() => loc.currencies.filter((c) => c.status === 'active'))
  const [savedLanguages, setSavedLanguages] = useState(() => loc.languages.filter((l) => l.status === 'active').map((l) => l.code))
  const [form, setForm] = useState<StoreInfoForm>(saved)
  const [infoProblem, setInfoProblem] = useState<{ field: 'name' | 'next'; text: string } | null>(null)
  const [logoProblem, setLogoProblem] = useState<string | null>(null)
  const [currencies, setCurrencies] = useState<Currency[]>(savedCurrencies)
  const [languages, setLanguages] = useState<string[]>(savedLanguages)
  const [progress, setProgress] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<'info' | 'currencies' | 'languages' | 'logo' | null>(null)
  const [failure, setFailure] = useState<{ card: 'info' | 'currencies' | 'languages'; text: string } | null>(null)
  const [ask, setAsk] = useState<Ask | null>(null)
  const ro = !canEdit
  const labels = labelsFor(info.country)
  const main = loc.mainLanguage ?? languages[0] ?? ''

  const counted = savedLanguages.filter((c) => c !== main)
  useEffect(() => {
    let live = true
    void loadTranslationProgress(counted).then(
      (all) =>
        live &&
        setProgress(Object.fromEntries(counted.map((code) => {
          const p = all.get(code)
          return [code, p ? fill(words.translated, { done: formatCount(p.products - p.untranslated), count: formatCount(p.products) }) : words.progressFailed]
        }))),
      () => live && setProgress(Object.fromEntries(counted.map((code) => [code, words.progressFailed]))),
    )
    return () => {
      live = false
    }
    // Read again only when the saved languages change; a language just added has nothing translated yet.
  }, [counted.join()])

  const dirtyInfo = JSON.stringify(form) !== JSON.stringify(saved)
  const dirtyCurrencies = JSON.stringify(currencies.map(({ code, mode, rounding }) => ({ code, mode, rounding }))) !== JSON.stringify(savedCurrencies.map(({ code, mode, rounding }) => ({ code, mode, rounding })))
  const dirtyLanguages = JSON.stringify(languages) !== JSON.stringify(savedLanguages)

  const write = async (card: 'info' | 'currencies' | 'languages', work: () => Promise<void>, toast: string, done: () => void) => {
    setBusy(card)
    setFailure(null)
    try {
      await work()
      done()
      onSaved(toast)
    } catch (error) {
      setFailure({ card, text: refusalText(error) })
    } finally {
      setBusy(null)
    }
  }

  const saveInfo = () => {
    if (form.name.trim() === '') return setInfoProblem({ field: 'name', text: words.nameMissing })
    if (!/^\d{1,9}$/.test(form.nextOrderNumber.trim()) || Number(form.nextOrderNumber) < 1) return setInfoProblem({ field: 'next', text: words.nextMissing })
    setInfoProblem(null)
    const sent = { ...form, orderPrefix: form.orderPrefix.toUpperCase(), nextOrderNumber: String(Number(form.nextOrderNumber)) }
    void write('info', () => saveStoreInfo({ ...sent, nextOrderNumber: Number(sent.nextOrderNumber) }), words.savedInfo, () => {
      setSaved(sent)
      setForm(sent)
    })
  }

  const logo = (file: File | undefined) => {
    if (!file) return
    if (file.size > 5_000_000) return setLogoProblem(fill(words.logoTooBig, { size: (file.size / 1_000_000).toFixed(1) }))
    setLogoProblem(null)
    setBusy('logo')
    void uploadPhoto(file).then((r) => {
      setBusy(null)
      if (r.ok) setForm((f) => ({ ...f, logoAssetId: r.assetId }))
      else setLogoProblem(words.logoFailed)
    })
  }

  const field = (key: 'name' | 'legalName' | 'description' | 'contactEmail' | 'contactPhone' | 'taxId', label: string, help: string, wide = false, max = 200) => (
    <div className={wide ? 'df-set-field df-set-field--wide' : 'df-set-field'}>
      <label htmlFor={`${id}-${key}`}>{label}</label>
      {help && <span className="df-set-help">{help}</span>}
      <input
        id={`${id}-${key}`}
        value={form[key]}
        readOnly={ro}
        maxLength={max}
        aria-invalid={key === 'name' && infoProblem?.field === 'name'}
        aria-describedby={key === 'name' && infoProblem?.field === 'name' ? `${id}-name-problem` : undefined}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
      />
      {key === 'name' && infoProblem?.field === 'name' && (
        <span id={`${id}-name-problem`} className="df-set-problem">
          {infoProblem.text}
        </span>
      )}
    </div>
  )
  const address = (key: 'street' | 'city' | 'postal' | 'region', label: string, help = '', wide = false) => (
    <div className={wide ? 'df-set-field df-set-field--wide' : 'df-set-field'}>
      <label htmlFor={`${id}-${key}`}>{label}</label>
      {help && <span className="df-set-help">{help}</span>}
      <input id={`${id}-${key}`} value={form.address[key]} readOnly={ro} maxLength={200} onChange={(e) => setForm({ ...form, address: { ...form.address, [key]: e.target.value } })} />
    </div>
  )

  const stopConverting = (c: Currency) =>
    setAsk({
      title: fill(words.stopTitle, { code: c.code }),
      target: c.code,
      consequence: fill(words.stopBody, { code: c.code }),
      confirmLabel: words.stopConfirm,
      onConfirm: () => setCurrencies((list) => list.map((x) => (x.code === c.code ? { ...x, mode: 'manual' } : x))),
    })

  return (
    <div className="df-set-store">
      <section className="df-set-card" aria-labelledby={`${id}-info`}>
        <h2 id={`${id}-info`}>{words.title}</h2>
        {failure?.card === 'info' && (
          <p className="df-set-failure" role="alert">
            {failure.text}
          </p>
        )}
        <div className="df-set-grid">
          {field('name', words.name, words.nameHelp, false, 80)}
          {field('legalName', words.legal, words.legalHelp)}
          {field('description', words.description, fill(words.descriptionHelp, { count: String(form.description.length) }), true, 120)}
          {field('contactEmail', words.email, words.emailHelp, false, 320)}
          {field('contactPhone', words.phone, '', false, 40)}
          {address('street', words.street, words.streetHelp, true)}
          {address('city', words.city)}
          {address('postal', labels.postal)}
          {address('region', labels.region)}
          <div className="df-set-field">
            <label htmlFor={`${id}-country`}>{words.countryLabel}</label>
            <span className="df-set-help">{words.countryHelp}</span>
            <input id={`${id}-country`} value={info.country ? (new Intl.DisplayNames([locale], { type: 'region' }).of(info.country) ?? info.country) : ''} readOnly className="df-set-locked" />
          </div>
          {field('taxId', labels.taxId, labels.taxHelp, true, 30)}
        </div>
        <div className="df-set-grid df-set-grid--three">
          <div className="df-set-field">
            <label htmlFor={`${id}-tz`}>{words.timeZone}</label>
            <span className="df-set-help">{words.timeZoneHelp}</span>
            <select id={`${id}-tz`} value={form.timeZone} disabled={ro} onChange={(e) => setForm({ ...form, timeZone: e.target.value })}>
              {zones(form.timeZone).map((z) => (
                <option key={z.value} value={z.value}>
                  {z.label}
                </option>
              ))}
            </select>
          </div>
          <div className="df-set-field">
            <label htmlFor={`${id}-units`}>{words.units}</label>
            <span className="df-set-help">{words.unitsHelp}</span>
            <select id={`${id}-units`} value={form.unitSystem} disabled={ro} onChange={(e) => setForm({ ...form, unitSystem: e.target.value === 'imperial' ? 'imperial' : 'metric' })}>
              <option value="metric">{words.metric}</option>
              <option value="imperial">{words.imperial}</option>
            </select>
          </div>
          <div className="df-set-field">
            <span className="df-set-label" id={`${id}-orders`}>
              {words.orders}
            </span>
            <span className="df-set-help">{fill(words.nextOrder, { number: `${form.orderPrefix.toUpperCase()}${form.nextOrderNumber}` })}</span>
            <span className="df-set-pair" role="group" aria-labelledby={`${id}-orders`}>
              <input aria-label={words.prefix} className="df-set-mono" value={form.orderPrefix} readOnly={ro} maxLength={6} onChange={(e) => setForm({ ...form, orderPrefix: e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '') })} />
              <input
                aria-label={words.nextNumber}
                className="df-set-mono"
                inputMode="numeric"
                value={form.nextOrderNumber}
                readOnly={ro}
                maxLength={9}
                aria-invalid={infoProblem?.field === 'next'}
                aria-describedby={infoProblem?.field === 'next' ? `${id}-next-problem` : undefined}
                onChange={(e) => setForm({ ...form, nextOrderNumber: e.target.value.replace(/\D/g, '') })}
              />
            </span>
            {infoProblem?.field === 'next' && (
              <span id={`${id}-next-problem`} className="df-set-problem">
                {infoProblem.text}
              </span>
            )}
          </div>
        </div>
        <div className="df-set-logo">
          {form.logoAssetId ? (
            <AssetImage url={`/api/assets/${form.logoAssetId}`} alt={words.logoAlt} className="df-set-logo-image" placeholder="" />
          ) : (
            <span className="df-set-logo-initial" aria-hidden="true">
              {(form.name.trim() || 'S').slice(0, 1).toUpperCase()}
            </span>
          )}
          <span className={logoProblem ? 'df-set-problem' : 'df-set-help'} role={logoProblem ? 'alert' : undefined}>
            {logoProblem ?? (form.logoAssetId !== saved.logoAssetId ? words.logoNew : words.logoHelp)}
          </span>
          {canEdit && (
            <label className="df-button df-button--small df-set-upload">
              {busy === 'logo' ? words.uploading : words.replace}
              <input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy !== null} onChange={(e) => logo(e.target.files?.[0])} />
            </label>
          )}
        </div>
        <div className="df-set-foot">
          <span className="df-set-help">{words.savesCard}</span>
          {canEdit && (
            <button type="button" className="df-button df-button--primary" disabled={busy !== null || !dirtyInfo} onClick={saveInfo}>
              {busy === 'info' ? words.saving : words.saveInfo}
            </button>
          )}
        </div>
      </section>

      <section className="df-set-card" aria-labelledby={`${id}-cur`}>
        <h2 id={`${id}-cur`}>{words.currencies}</h2>
        <p className="df-set-lede">{words.currenciesSub}</p>
        {failure?.card === 'currencies' && (
          <p className="df-set-failure" role="alert">
            {failure.text}
          </p>
        )}
        <div className="df-set-currency df-set-currency--main">
          <strong>{loc.pricingCurrency ?? ''}</strong>
          <span>{words.mainCurrency}</span>
        </div>
        {currencies.map((c) => {
          const shown = loc.pricingCurrency ? example(loc.pricingCurrency, c.code, c.rounding, loc.rates) : null
          return (
            <div key={c.code} className="df-set-currency">
              <div className="df-set-currency-head">
                <strong>{c.code}</strong>
                <span>{c.mode === 'convert' ? fill(words.converted, { code: loc.pricingCurrency ?? '' }) : words.typed}</span>
                {canEdit && (
                  <>
                    <button type="button" role="switch" aria-checked={c.mode === 'convert'} className="df-set-switch" onClick={() => (c.mode === 'convert' ? stopConverting(c) : setCurrencies((list) => list.map((x) => (x.code === c.code ? { ...x, mode: 'convert', rounding: 'ends-99' } : x))))}>
                      <span aria-hidden="true" />
                      {words.convert}
                    </button>
                    <button type="button" className="df-set-link" onClick={() => setCurrencies((list) => list.filter((x) => x.code !== c.code))}>
                      {fill(words.remove, { name: c.code })}
                    </button>
                  </>
                )}
              </div>
              {c.mode === 'convert' ? (
                <div className="df-set-currency-round">
                  <label htmlFor={`${id}-round-${c.code}`}>{words.round}</label>
                  <select id={`${id}-round-${c.code}`} value={c.rounding} disabled={ro} onChange={(e) => setCurrencies((list) => list.map((x) => (x.code === c.code ? { ...x, rounding: e.target.value === 'none' ? 'none' : e.target.value === 'nearest' ? 'nearest' : 'ends-99' } : x)))}>
                    <option value="none">{words.roundNone}</option>
                    <option value="nearest">{words.roundNearest}</option>
                    <option value="ends-99">{words.round99}</option>
                  </select>
                  <span>{shown ? fill(words.rates, { example: shown, date: loc.rates[0]?.publishedOn ?? '' }) : words.noRate}</span>
                </div>
              ) : (
                <p className="df-set-typed">{fill(words.typedNote, { code: c.code })}</p>
              )}
            </div>
          )
        })}
        {canEdit && (
          <div className="df-set-foot">
            <select
              aria-label={words.addCurrency}
              value=""
              onChange={(e) => {
                const code = e.target.value
                if (code) setCurrencies((list) => [...list, { code, mode: 'convert', rounding: 'ends-99', status: 'active' }])
              }}
            >
              <option value="">{words.addCurrency}</option>
              {addableCurrencies(loc, currencies).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <button type="button" className="df-button df-button--primary" disabled={busy !== null || !dirtyCurrencies} onClick={() => void write('currencies', () => saveCurrencies(currencies.map(({ code, mode, rounding }) => ({ code, mode, rounding }))), words.savedCurrencies, () => setSavedCurrencies(currencies))}>
              {busy === 'currencies' ? words.saving : words.saveCurrencies}
            </button>
          </div>
        )}
        <span className="df-set-help">{fill(words.mainFixed, { code: loc.pricingCurrency ?? '' })}</span>
      </section>

      <section className="df-set-card" aria-labelledby={`${id}-lang`}>
        <h2 id={`${id}-lang`}>{words.languages}</h2>
        <p className="df-set-lede">{words.languagesSub}</p>
        {failure?.card === 'languages' && (
          <p className="df-set-failure" role="alert">
            {failure.text}
          </p>
        )}
        <ul className="df-set-languages">
          {languages.map((code) => (
            <li key={code}>
              <strong>{languageName(code)}</strong>
              <span>{code === main ? words.mainLanguage : savedLanguages.includes(code) ? (progress[code] ?? words.progressLoading) : words.notYet}</span>
              {canEdit && code !== main && (
                <button
                  type="button"
                  className="df-set-link"
                  onClick={() =>
                    setAsk({ title: fill(words.removeLanguageTitle, { name: languageName(code) }), target: languageName(code), consequence: words.removeLanguageBody, confirmLabel: words.removeLanguage, onConfirm: () => setLanguages((l) => l.filter((x) => x !== code)) })
                  }
                >
                  {fill(words.remove, { name: languageName(code) })}
                </button>
              )}
            </li>
          ))}
        </ul>
        {canEdit && (
          <div className="df-set-foot">
            <select
              aria-label={words.addLanguage}
              value=""
              onChange={(e) => {
                const code = e.target.value
                if (code) setLanguages((l) => [...l, code])
              }}
            >
              <option value="">{words.addLanguage}</option>
              {loc.offeredLanguages
                .filter((c) => !languages.includes(c))
                .map((c) => (
                  <option key={c} value={c}>
                    {languageName(c)}
                  </option>
                ))}
            </select>
            <button type="button" className="df-button df-button--primary" disabled={busy !== null || !dirtyLanguages} onClick={() => void write('languages', () => saveLanguages(languages, main), words.savedLanguages, () => setSavedLanguages(languages))}>
              {busy === 'languages' ? words.saving : words.saveLanguages}
            </button>
          </div>
        )}
      </section>
      {ask && <ConfirmDialog key={`${ask.title}|${ask.target}`} {...ask} open cancelLabel={words.cancel} onCancel={() => setAsk(null)} onConfirm={(...args) => { setAsk(null); ask.onConfirm(...args) }} />}
    </div>
  )
}
