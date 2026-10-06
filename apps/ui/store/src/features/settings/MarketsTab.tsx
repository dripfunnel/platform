import { minorOf, moneyText } from '@dripfunnel/shared/format'
import { isApiError } from '@dripfunnel/shared/graphql'
import { ConfirmDialog, type ConfirmDialogProps } from '@dripfunnel/shared/ui'
import { useId, useState } from 'react'
import { deleteMarket, loadAllMarkets, saveMarket, setEverywhereElse, type Market } from '../../api/markets'
import type { StoreLocale } from '../../api/settings'
import { fill, formatList, locale, messages } from '../../messages'
import { ProductSearch } from '../common/ProductSearch'
import { RadioCards } from '../common/RadioCards'

const words = messages.settings.markets

type Ask = Omit<ConfirmDialogProps, 'open' | 'onCancel' | 'cancelLabel'>

/** The countries offered first, as the prototype does; any other is one pick away. */
const featured = ['US', 'CA', 'GB', 'DE', 'FR', 'NL', 'AT', 'IT', 'ES', 'IN', 'AE', 'AU', 'JP']
const everyCountry =
  'AD AE AF AG AL AM AO AR AT AU AZ BA BB BD BE BG BH BN BO BR BS BT BW BY BZ CA CH CL CN CO CR CY CZ DE DK DO DZ EC EE EG ES ET FI FJ FR GB GE GH GR GT HK HN HR HU ID IE IL IN IQ IS IT JM JO JP KE KH KR KW KZ LA LB LK LT LU LV MA MC MD ME MK MM MN MO MT MU MV MX MY NA NG NI NL NO NP NZ OM PA PE PH PK PL PR PT PY QA RO RS RW SA SE SG SI SK SN SV TH TN TR TT TW TZ UA UG US UY UZ VN ZA ZM'.split(' ')

const countryName = (code: string) => new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code
const languageName = (code: string) => new Intl.DisplayNames([locale], { type: 'language' }).of(code) ?? code

/** A market as the editor holds it: numbers and money as typed, until saved. */
export interface MarketDraft {
  id: string | null
  revision: number | null
  name: string
  parentId: string | null
  primary: boolean
  active: boolean
  countries: string[]
  currency: string
  language: string
  adjust: string
  webMode: 'main' | 'path'
  pathPrefix: string
  products: 'all' | 'some'
  /** `gone`: deleted since, shown so the merchant knows, and left out of the save (the API refuses an id it can't find). */
  excluded: { id: string; name: string; gone?: boolean }[]
  duties: 'none' | 'by_code' | 'flat'
  dutyRate: string
  dutyThreshold: string
}

export const draftOfMarket = (m: Market): MarketDraft => ({
  id: m.id,
  revision: m.revision,
  name: m.name,
  parentId: m.parentId,
  primary: m.primary,
  active: m.active,
  countries: [...m.countries],
  currency: m.currency,
  language: m.language,
  adjust: m.priceAdjustmentBps === 0 ? '' : String(m.priceAdjustmentBps / 100),
  webMode: m.webMode,
  pathPrefix: m.pathPrefix ?? '',
  products: m.products,
  // An id the API no longer names was a product deleted since: shown as such, and dropped by the save.
  excluded: m.excludedProductIds.map((pid) => {
    const named = m.excludedProducts.find((p) => p.id === pid)
    return named ? { id: pid, name: named.name } : { id: pid, name: words.deletedProduct, gone: true }
  }),
  duties: m.duties.mode,
  dutyRate: m.duties.rateBps === null ? '' : String(m.duties.rateBps / 100),
  dutyThreshold: m.duties.thresholdAmount ? moneyText({ amount: Number(m.duties.thresholdAmount), currency: m.currency }) : '',
})

/** What can't be saved yet, said before the API would refuse it; a sub-market sells in its parent's countries only. */
export const marketProblem = (d: MarketDraft, parentCountries: readonly string[] | null = null): keyof typeof words.problems | null => {
  if (d.name.trim() === '') return 'name'
  if (d.countries.length === 0) return 'countries'
  if (parentCountries && d.countries.some((c) => !parentCountries.includes(c))) return 'parentCountries'
  if (d.adjust.trim() !== '' && !/^-?\d+(\.\d{1,2})?$/.test(d.adjust.trim())) return 'adjust'
  if (d.webMode === 'path' && !/^[a-z0-9][a-z0-9-]{0,19}$/.test(d.pathPrefix.trim())) return 'path'
  if (d.duties === 'flat' && !/^\d+(\.\d{1,2})?$/.test(d.dutyRate.trim())) return 'dutyRate'
  if (d.duties !== 'none' && d.dutyThreshold.trim() !== '' && typeof minorOf(d.dutyThreshold, d.currency) !== 'number') return 'dutyThreshold'
  return null
}

const inputOf = (d: MarketDraft) => {
  const threshold = d.duties !== 'none' && d.dutyThreshold.trim() !== '' ? minorOf(d.dutyThreshold, d.currency) : null
  return {
    name: d.name.trim(),
    parentId: d.parentId,
    active: d.primary || d.active,
    countries: d.countries,
    currency: d.currency,
    language: d.language,
    priceAdjustmentBps: d.adjust.trim() === '' ? 0 : Math.round(Number(d.adjust) * 100),
    webMode: d.webMode,
    pathPrefix: d.webMode === 'path' ? d.pathPrefix.trim() : null,
    products: d.products,
    excludedProductIds: d.products === 'some' ? d.excluded.filter((p) => !p.gone).map((p) => p.id) : [],
    dutiesMode: d.duties,
    dutiesRateBps: d.duties === 'flat' ? Math.round(Number(d.dutyRate) * 100) : null,
    dutiesThresholdAmount: typeof threshold === 'number' ? String(threshold) : null,
  }
}

const refusalOf = (error: unknown): string => (isApiError(error) ? ((words.refused as Record<string, string>)[error.code] ?? words.refused.other) : words.refused.other)

export interface MarketsTabProps {
  markets: readonly Market[]
  locale: StoreLocale
  canEdit: boolean
  onSaved: (toast: string) => void
}

/** SetMarkets: the store's markets on the left, "everywhere else" under them, and the one picked beside. */
export const MarketsTab = ({ markets: given, locale: loc, canEdit, onSaved }: MarketsTabProps) => {
  const id = useId()
  // The list as saved here: a save, delete or "everywhere else" answers what's stored, so the tab isn't read again.
  const [markets, setMarkets] = useState<Market[]>([...given])
  const first = markets.find((m) => m.primary) ?? markets[0] ?? null
  const [draft, setDraft] = useState<MarketDraft | null>(first ? draftOfMarket(first) : null)
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [ask, setAsk] = useState<Ask | null>(null)
  const ro = !canEdit || busy
  const tops = markets.filter((m) => m.parentId === null)
  const fallback = markets.find((m) => m.everywhereElse)?.id ?? ''
  const currencies = [loc.pricingCurrency ?? '', ...loc.currencies.filter((c) => c.status === 'active').map((c) => c.code)].filter(Boolean)
  const languages = loc.languages.filter((l) => l.status === 'active').map((l) => l.code)
  const saved = draft?.id ? markets.find((m) => m.id === draft.id) : null
  const dirty = draft !== null && (saved ? JSON.stringify(draft) !== JSON.stringify(draftOfMarket(saved)) : true)

  const pick = (m: Market) => {
    const go = () => {
      setDraft(draftOfMarket(m))
      setTried(false)
      setFailure(null)
    }
    if (dirty) setAsk({ title: words.leaveTitle, target: '', consequence: words.leaveBody, confirmLabel: words.discard, danger: true, onConfirm: go })
    else go()
  }

  /** A new market replaces the one open, so unsaved changes ask first, as picking another does. */
  const add = () => (dirty ? setAsk({ title: words.leaveTitle, target: '', consequence: words.leaveBody, confirmLabel: words.discard, danger: true, onConfirm: startNew }) : startNew())
  const startNew = () =>
    setAsk({
      title: words.newTitle,
      target: '',
      consequence: words.newBody,
      confirmLabel: words.create,
      input: { label: words.name, type: 'text', initial: '', placeholder: words.namePlaceholder, error: (v) => (v.trim() === '' ? words.problems.name : null) },
      onConfirm: (_, value) => {
        setDraft({ id: null, revision: null, name: (value ?? '').trim(), parentId: null, primary: false, active: true, countries: [], currency: loc.pricingCurrency ?? currencies[0] ?? '', language: loc.mainLanguage ?? languages[0] ?? '', adjust: '', webMode: 'main', pathPrefix: '', products: 'all', excluded: [], duties: 'none', dutyRate: '', dutyThreshold: '' })
        setTried(false)
      },
    })

  const run = async (work: () => Promise<string>) => {
    setBusy(true)
    setFailure(null)
    try {
      onSaved(await work())
    } catch (error) {
      // Someone else changed or deleted it: read the markets again, so the next try starts from what's saved.
      if (isApiError(error) && (error.code === 'STALE_REVISION' || error.code === 'NOT_FOUND')) {
        const opened = draft?.id ?? null
        try {
          const fresh = await loadAllMarkets()
          setMarkets(fresh)
          // A market not saved yet keeps everything typed; a saved one shows what's stored now, or closes if it's gone.
          if (opened !== null) {
            const again = fresh.find((m) => m.id === opened)
            setDraft(again ? draftOfMarket(again) : null)
          }
          setFailure(fill(words.reread, { refusal: refusalOf(error) }))
        } catch {
          setFailure(refusalOf(error))
        }
      } else setFailure(refusalOf(error))
    } finally {
      setBusy(false)
    }
  }

  const list = (
    <div className="df-mkt-side">
      <div className="df-team-head">
        <div>
          <h2>{words.title}</h2>
          <p>{words.sub}</p>
        </div>
        {canEdit && (
          <button type="button" className="df-button df-button--primary df-button--small" disabled={busy} onClick={add}>
            {words.add}
          </button>
        )}
      </div>
      <ul className="df-mkt-list" aria-label={words.title}>
        {tops.flatMap((top) => [top, ...markets.filter((m) => m.parentId === top.id)]).map((m) => (
          <li key={m.id}>
            <button type="button" aria-current={draft?.id === m.id ? 'true' : undefined} className={m.parentId ? 'df-mkt-item df-mkt-item--sub' : 'df-mkt-item'} onClick={() => pick(m)}>
              <span>
                <strong>{m.name}</strong>
                <span>{fill(words.rowSub, { countries: formatList(m.countries.map(countryName)), currency: m.currency })}</span>
              </span>
              <span className={`df-mkt-tag df-mkt-tag--${m.primary ? 'primary' : m.active ? 'on' : 'off'}`}>{m.primary ? words.primary : !m.active ? words.off : m.parentId ? words.subMarket : words.active}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="df-set-card df-mkt-else">
        <label htmlFor={`${id}-else`}>{words.elseTitle}</label>
        <span className="df-set-help">{words.elseSub}</span>
        <select id={`${id}-else`} value={fallback} disabled={ro} onChange={(e) => {
            const chosen = e.target.value || null
            void run(async () => {
              await setEverywhereElse(chosen)
              setMarkets((list) => list.map((m) => ({ ...m, everywhereElse: m.id === chosen })))
              return words.elseSaved
            })
          }}>
          <option value="">{words.nobody}</option>
          {tops.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  )

  if (!draft)
    return (
      <div className="df-mkt">
        {list}
        <p className="df-set-pick">{words.pickOne}</p>
        {ask && <ConfirmDialog key={`${ask.title}|${ask.target}`} {...ask} open cancelLabel={words.cancel} onCancel={() => setAsk(null)} onConfirm={(...args) => { setAsk(null); ask.onConfirm(...args) }} />}
      </div>
    )

  const set = (patch: Partial<MarketDraft>) => setDraft({ ...draft, ...patch })
  const parent = markets.find((m) => m.id === draft.parentId) ?? null
  const problem = marketProblem(draft, parent?.countries ?? null)
  const outsideParent = (c: string) => parent !== null && !parent.countries.includes(c)
  const related = (m: Market) => m.id === draft.id || m.parentId === draft.id || m.id === draft.parentId
  const taken = new Map(markets.filter((m) => !related(m)).flatMap((m) => m.countries.map((c) => [c, m.name] as const)))
  // A sub-market picks from its parent's countries; the rest are offered only where it already has them, marked.
  const offered = [...new Set([...(parent ? parent.countries : featured), ...draft.countries])]
  const preview =
    draft.countries.length === 0
      ? words.pickCountry
      : fill(words.preview, {
          country: countryName(draft.countries[0] ?? ''),
          currency: draft.currency,
          language: languageName(draft.language),
          where: draft.webMode === 'path' ? `/${draft.pathPrefix || '…'}` : words.mainAddress,
        }) +
        (draft.adjust.trim() && Number(draft.adjust) !== 0 ? fill(words.previewAdjust, { adjust: `${Number(draft.adjust) > 0 ? '+' : ''}${draft.adjust}` }) : '') +
        (draft.products === 'some' && draft.excluded.length > 0 ? fill(words.previewExcluded, { count: String(draft.excluded.length) }) : '') +
        (draft.duties !== 'none' ? words.previewDuties : '')

  const save = () => {
    if (problem) return setTried(true)
    void run(async () => {
      const stored = await saveMarket(draft.id, draft.revision, inputOf(draft))
      setMarkets((list) => (list.some((m) => m.id === stored.id) ? list.map((m) => (m.id === stored.id ? stored : m)) : [...list, stored]))
      setDraft(draftOfMarket(stored))
      setTried(false)
      return fill(draft.id === null ? words.created : words.saved, { name: stored.name })
    })
  }
  const remove = () =>
    setAsk({
      title: fill(words.deleteTitle, { name: draft.name }),
      target: draft.name,
      consequence: fill(words.deleteBody, { countries: formatList(draft.countries.map(countryName)) || words.theseCountries }),
      confirmLabel: words.delete,
      danger: true,
      onConfirm: () =>
        void run(async () => {
          const gone = draft.id
          if (gone) await deleteMarket(gone)
          // Its sub-markets become top-level, a revision on, as the API moves them (db/scoped/markets.ts).
          setMarkets((list) => list.filter((m) => m.id !== gone).map((m) => (m.parentId === gone ? { ...m, parentId: null, revision: m.revision + 1 } : m)))
          setDraft(null)
          return fill(words.deleted, { name: draft.name })
        }),
    })

  return (
    <div className="df-mkt">
      {list}
      <div className="df-mkt-edit">
        {failure && (
          <p className="df-set-failure" role="alert">
            {failure}
          </p>
        )}
        <section className="df-set-card" aria-labelledby={`${id}-name`}>
          <div className="df-mkt-top">
            <label htmlFor={`${id}-name`} className="df-visually-hidden">
              {words.name}
            </label>
            <input id={`${id}-name`} className="df-mkt-name" value={draft.name} readOnly={ro} maxLength={60} aria-invalid={tried && problem === 'name'} onChange={(e) => set({ name: e.target.value })} />
            <button type="button" role="switch" aria-checked={draft.primary || draft.active} className="df-set-switch" disabled={ro || draft.primary} onClick={() => set({ active: !draft.active })}>
              <span aria-hidden="true" />
              {draft.primary || draft.active ? words.selling : words.notSelling}
            </button>
          </div>
          <p className="df-mkt-preview">{preview}</p>
          <span className="df-set-label" id={`${id}-countries`}>
            {words.countries}
          </span>
          <div className="df-mkt-countries" role="group" aria-labelledby={`${id}-countries`}>
            {offered.map((c) => {
              const on = draft.countries.includes(c)
              const elsewhere = !on ? taken.get(c) : undefined
              const note = elsewhere ? fill(words.inAnother, { name: elsewhere }) : outsideParent(c) && parent ? fill(words.notParents, { name: parent.name }) : null
              return (
                <button
                  key={c}
                  type="button"
                  aria-pressed={on}
                  disabled={ro || elsewhere !== undefined || (!on && outsideParent(c))}
                  aria-invalid={on && outsideParent(c) ? true : undefined}
                  className="df-mkt-chip"
                  title={note ?? undefined}
                  onClick={() => set({ countries: on ? draft.countries.filter((x) => x !== c) : [...draft.countries, c] })}
                >
                  {note ? fill(words.chipNote, { country: countryName(c), note }) : countryName(c)}
                </button>
              )
            })}
            {canEdit && (
              <select aria-label={words.anotherCountry} value="" disabled={ro} onChange={(e) => e.target.value && set({ countries: [...draft.countries, e.target.value] })}>
                <option value="">{words.anotherCountry}</option>
                {everyCountry
                  .filter((c) => !offered.includes(c) && !taken.has(c) && !outsideParent(c))
                  .map((c) => ({ c, n: countryName(c) }))
                  .sort((a, b) => a.n.localeCompare(b.n))
                  .map(({ c, n }) => (
                    <option key={c} value={c}>
                      {n}
                    </option>
                  ))}
              </select>
            )}
          </div>
          {tried && problem === 'countries' && <p className="df-set-problem">{words.problems.countries}</p>}
          {!draft.primary && (
            <div className="df-set-field">
              <label htmlFor={`${id}-parent`}>{words.parent}</label>
              <select
                id={`${id}-parent`}
                value={draft.parentId ?? ''}
                disabled={ro}
                onChange={(e) => {
                  const p = markets.find((m) => m.id === e.target.value)
                  set(p ? { parentId: p.id, currency: p.currency, language: p.language } : { parentId: null })
                  if (p) onSaved(fill(words.copied, { parent: p.name, name: draft.name }))
                }}
              >
                <option value="">{words.standsAlone}</option>
                {tops
                  .filter((m) => m.id !== draft.id)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {fill(words.inside, { name: m.name })}
                    </option>
                  ))}
              </select>
              {parent && <span className="df-set-help">{fill(words.parentCountries, { name: parent.name })}</span>}
            </div>
          )}
        </section>

        <section className="df-set-card df-set-grid" aria-label={words.rules}>
          <div className="df-set-field">
            <label htmlFor={`${id}-cur`}>{words.currency}</label>
            <span className="df-set-help">{draft.currency === loc.pricingCurrency ? words.mainCurrency : loc.currencies.find((c) => c.code === draft.currency)?.mode === 'manual' ? words.typedCurrency : words.convertedCurrency}</span>
            <select id={`${id}-cur`} value={draft.currency} disabled={ro} onChange={(e) => set({ currency: e.target.value })}>
              {currencies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="df-set-field">
            <label htmlFor={`${id}-lang`}>{words.language}</label>
            <span className="df-set-help">{words.languageHelp}</span>
            <select id={`${id}-lang`} value={draft.language} disabled={ro} onChange={(e) => set({ language: e.target.value })}>
              {languages.map((l) => (
                <option key={l} value={l}>
                  {languageName(l)}
                </option>
              ))}
            </select>
          </div>
          <div className="df-set-field">
            <label htmlFor={`${id}-adjust`}>{words.adjust}</label>
            <span className="df-set-help">{words.adjustHelp}</span>
            <span className="df-mkt-suffix">
              <input id={`${id}-adjust`} inputMode="decimal" value={draft.adjust} readOnly={ro} placeholder={words.placeholders.adjust} aria-invalid={tried && problem === 'adjust'} onChange={(e) => set({ adjust: e.target.value.replace(/[^\d.-]/g, '') })} />
              <span aria-hidden="true">{words.percent}</span>
            </span>
          </div>
          <div className="df-set-field">
            <label htmlFor={`${id}-web`}>{words.web}</label>
            <span className="df-set-help">{words.webHelp}</span>
            <select id={`${id}-web`} value={draft.webMode} disabled={ro} onChange={(e) => set({ webMode: e.target.value === 'path' ? 'path' : 'main' })}>
              <option value="main">{words.mainAddress}</option>
              <option value="path">{words.pathAddress}</option>
            </select>
            {draft.webMode === 'path' && (
              <input aria-label={words.path} className="df-set-mono" value={draft.pathPrefix} readOnly={ro} maxLength={20} placeholder={words.placeholders.path} aria-invalid={tried && problem === 'path'} onChange={(e) => set({ pathPrefix: e.target.value.toLowerCase() })} />
            )}
          </div>
        </section>

        <section className="df-set-card" aria-labelledby={`${id}-products`}>
          <span className="df-set-label" id={`${id}-products`}>
            {words.productsTitle}
          </span>
          <RadioCards
            labelledBy={`${id}-products`}
            value={draft.products}
            disabled={ro}
            onChange={(products) => set({ products })}
            options={[
              { value: 'all', label: words.allProducts },
              { value: 'some', label: words.allExcept },
            ]}
          />
          {draft.products === 'some' && (
            <>
              <div className="df-mkt-excluded">
                {draft.excluded.map((p) => (
                  <button key={p.id} type="button" className="df-mkt-off" disabled={ro} aria-label={fill(words.sellAgain, { name: p.name })} onClick={() => set({ excluded: draft.excluded.filter((x) => x.id !== p.id) })}>
                    {p.name}
                  </button>
                ))}
              </div>
              {canEdit && <ProductSearch label={words.findProduct} hide={draft.excluded.map((p) => p.id)} onPick={(p) => set({ excluded: [...draft.excluded, { id: p.id, name: p.name }] })} />}
              <span className="df-set-help">{words.excludedHelp}</span>
            </>
          )}
          <button type="button" role="switch" aria-checked={draft.duties !== 'none'} className="df-set-switch" disabled={ro} onClick={() => set({ duties: draft.duties === 'none' ? 'by_code' : 'none' })}>
            <span aria-hidden="true" />
            <span className="df-mkt-duty">
              <span>{words.duties}</span>
              <span className="df-set-help">{words.dutiesHelp}</span>
            </span>
          </button>
          {draft.duties !== 'none' && (
            <div className="df-set-grid df-set-grid--three df-mkt-duties">
              <div className="df-set-field">
                <label htmlFor={`${id}-dmode`}>{words.dutyMode}</label>
                <select id={`${id}-dmode`} value={draft.duties} disabled={ro} onChange={(e) => set({ duties: e.target.value === 'flat' ? 'flat' : 'by_code' })}>
                  <option value="by_code">{words.byCode}</option>
                  <option value="flat">{words.flat}</option>
                </select>
              </div>
              {draft.duties === 'flat' && (
                <div className="df-set-field">
                  <label htmlFor={`${id}-drate`}>{words.dutyRate}</label>
                  <input id={`${id}-drate`} inputMode="decimal" value={draft.dutyRate} readOnly={ro} placeholder={words.placeholders.dutyRate} aria-invalid={tried && problem === 'dutyRate'} onChange={(e) => set({ dutyRate: e.target.value.replace(/[^\d.]/g, '') })} />
                </div>
              )}
              <div className="df-set-field">
                <label htmlFor={`${id}-dmin`}>{fill(words.dutyMin, { currency: draft.currency })}</label>
                <span className="df-set-help">{words.dutyMinHelp}</span>
                <input id={`${id}-dmin`} inputMode="decimal" value={draft.dutyThreshold} readOnly={ro} placeholder={words.placeholders.dutyThreshold} aria-invalid={tried && problem === 'dutyThreshold'} onChange={(e) => set({ dutyThreshold: e.target.value })} />
              </div>
            </div>
          )}
        </section>

        {tried && problem && (
          <p className="df-set-problem" role="alert">
            {words.problems[problem]}
          </p>
        )}
        {canEdit && (
          <div className="df-set-actions">
            {draft.id && !draft.primary && (
              <button type="button" className="df-button df-set-delete" disabled={busy} onClick={remove}>
                {words.delete}
              </button>
            )}
            <button type="button" className="df-button df-button--primary" disabled={busy || !dirty} onClick={save}>
              {words.save}
            </button>
          </div>
        )}
      </div>
      {ask && <ConfirmDialog key={`${ask.title}|${ask.target}`} {...ask} open cancelLabel={words.cancel} onCancel={() => setAsk(null)} onConfirm={(...args) => { setAsk(null); ask.onConfirm(...args) }} />}
    </div>
  )
}
