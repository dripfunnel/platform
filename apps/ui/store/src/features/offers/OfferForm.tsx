import { minorOf } from '@dripfunnel/shared/format'
import { Link } from '@tanstack/react-router'
import { useEffect, useId, useState, type ReactNode } from 'react'
import type { CollectionSummary } from '../../api/collections'
import { loadCustomers, type CustomerGroup } from '../../api/customers'
import type { Filter } from '../../api/filters'
import type { Market } from '../../api/markets'
import { fill, formatCount, formatList, messages } from '../../messages'
import '../common/chips.css'
import { RadioCards } from '../common/RadioCards'
import { convertedText, generateCode, localOf, offerLimits, type Amounts, type Field, type Minimum, type OfferDraft, type StoreFacts, type Target, type Who } from './offerDraft'
import { countryName, repeatText, weekdayName, type RegionWords } from './offerView'
import { moneyText, zoneName } from '../orders/orderView'

// The editor's five questions and "With other offers" (designs/OfferEditor.dc.html, Set up; OFFERS-DESIGN C–M), one
// page, in §1's order. Only what the API can save is drawn (§7: no dead controls).

const words = messages.offers.editor

export interface FormLists {
  filters: Filter[]
  collections: CollectionSummary[]
  groups: CustomerGroup[]
  markets: Market[]
}

export interface FormProps {
  draft: OfferDraft
  set: (patch: Partial<OfferDraft>) => void
  errors: Partial<Record<Field, string>>
  facts: StoreFacts
  region: RegionWords
  lists: FormLists
  productNames: ReadonlyMap<string, string>
  customerNames: ReadonlyMap<string, string>
  onCustomerName: (id: string, name: string) => void
  onPick: (field: 'productIds' | 'buyIds' | 'getIds') => void
  onCreateGroup: (name: string) => Promise<string | null>
  /** The code a live offer had when opened, which stops working once changed (H5). */
  liveCode: string | null
  isNew: boolean
  disabled: boolean
}

/** A typed amount as money, formatted with Intl like every other figure (zero while nothing valid is typed). */
export const typedMoney = (text: string, currency: string): string => {
  const minor = minorOf(text, currency)
  return moneyText({ amount: String(typeof minor === 'number' ? minor : 0), currency })
}

const Section = ({ n, title, aside, children }: { n?: number; title: string; aside?: ReactNode; children: ReactNode }) => {
  const id = useId()
  return (
    <section className="df-offer-section" aria-labelledby={id}>
      <div className="df-offer-section-head">
        {n !== undefined && (
          <span className="df-offer-step" aria-hidden="true">
            {n}
          </span>
        )}
        <h2 id={id}>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

const Problem = ({ text }: { text: string | undefined }) => (text ? <span className="df-offers-error" role="alert">{text}</span> : null)

/** One money box per currency the store sells in: the main one typed, the others pre-filled by conversion and editable (#337). */
const AmountBoxes = ({ label, value, onChange, facts, invalid, disabled }: { label: string; value: Amounts; onChange: (v: Amounts) => void; facts: StoreFacts; invalid: boolean; disabled: boolean }) => (
  <>
    <label className="df-offer-inline">
      <span>{label}</span>
      <span className="df-offer-affixed">
        <input value={value[facts.main] ?? ''} inputMode="decimal" readOnly={disabled} aria-invalid={invalid || undefined} onChange={(e) => onChange({ ...value, [facts.main]: e.target.value.replace(/[^\d.]/g, '') })} />
        <span>{facts.main}</span>
      </span>
    </label>
    {facts.others.length > 0 && (
      <div className="df-offer-currencies">
        <span className="df-offer-label">{words.otherCurrencies}</span>
        <div>
          {facts.others.map((c) => (
            <label key={c} className="df-offer-affixed">
              <input value={value[c] ?? ''} inputMode="decimal" readOnly={disabled} aria-label={fill(words.amountIn, { currency: c })} placeholder={convertedText(value[facts.main] ?? '', facts, c) ?? ''} onChange={(e) => onChange({ ...value, [c]: e.target.value.replace(/[^\d.]/g, '') })} />
              <span>{c}</span>
            </label>
          ))}
        </div>
        <span className="df-offers-sub">{words.otherCurrenciesHelp}</span>
      </div>
    )}
  </>
)

const Chips = ({ ids, names, label, onRemove, disabled }: { ids: readonly string[]; names: ReadonlyMap<string, string>; label: string; onRemove: (id: string) => void; disabled: boolean }) => (
  <>
    {ids.map((id) => {
      const name = names.get(id) ?? words.unnamed
      return (
        <span key={id} className="df-offer-chip">
          {name}
          {!disabled && (
            <button type="button" aria-label={fill(label, { name })} onClick={() => onRemove(id)}>
              <span aria-hidden="true">{words.removeGlyph}</span>
            </button>
          )}
        </span>
      )
    })}
  </>
)

/** "Specific customers" (I3): search the store's customers by name or email, and pick. */
const CustomerSearch = ({ chosen, onPick }: { chosen: readonly string[]; onPick: (id: string, name: string) => void }) => {
  const [q, setQ] = useState('')
  const [found, setFound] = useState<{ id: string; name: string }[] | 'failed' | null>(null)
  useEffect(() => {
    const typed = q.trim()
    if (typed.length < 2) return setFound(null)
    let live = true
    const timer = setTimeout(
      () =>
        void loadCustomers(null, typed).then(
          (page) => live && setFound(page.rows.map((r) => ({ id: r.id, name: r.name ?? r.email ?? words.unnamed }))),
          () => live && setFound('failed'),
        ),
      300,
    )
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [q])
  const rows = Array.isArray(found) ? found.filter((r) => !chosen.includes(r.id)).slice(0, 8) : []
  return (
    <div className="df-offer-search">
      <input type="search" value={q} aria-label={words.findCustomer} placeholder={words.findCustomer} onChange={(e) => setQ(e.target.value)} />
      <div role="status">
        {found === 'failed' && <span className="df-offers-error">{words.searchFailed}</span>}
        {Array.isArray(found) && rows.length === 0 && <span className="df-offers-sub">{fill(words.customersNone, { query: q.trim() })}</span>}
        {rows.map((r) => (
          <button key={r.id} type="button" className="df-chip" onClick={() => onPick(r.id, r.name)}>
            {fill(words.addName, { name: r.name })}
          </button>
        ))}
      </div>
    </div>
  )
}

export const OfferForm = ({ draft: d, set, errors: e, facts, region, lists, productNames, customerNames, onCustomerName, onPick, onCreateGroup, liveCode, isNew, disabled }: FormProps) => {
  const ids = { kind: useId(), target: useId(), how: useId(), minimum: useId(), who: useId() }
  const [newGroup, setNewGroup] = useState('')
  const [groupNote, setGroupNote] = useState<string | null>(null)
  const ship = region.ship
  const filter = lists.filters.find((f) => f.values.some((v) => d.filterValueIds.includes(v.id))) ?? lists.filters[0]
  const code = d.code.trim().toUpperCase()
  const hasCodeError = Boolean(e.code)
  const markets = lists.markets.filter((m) => m.active && m.countries.length > 0)
  const marketOf = markets.find((m) => m.countries.length === d.countries.length && m.countries.every((c) => d.countries.includes(c)))

  const andParts = [
    d.minimum === 'amount' && d.minAmounts[facts.main] ? fill(words.and.amount, { amount: typedMoney(d.minAmounts[facts.main] ?? '', facts.main) }) : '',
    (d.minimum === 'items' || d.minimum === 'these') && d.minQuantity ? fill(words.and.items, { count: d.minQuantity }) : '',
    d.who === 'groups' ? words.and.group : d.who === 'first' ? words.and.first : d.who === 'customers' ? words.and.customers : d.who === 'market' ? fill(words.and.market, { market: marketOf?.name ?? formatList(d.countries.map(countryName)) }) : '',
    d.type === 'products' ? words.and.product : '',
  ].filter(Boolean)

  const create = () => {
    const name = newGroup.trim()
    if (!name) return
    void onCreateGroup(name).then((id) => {
      if (!id) return
      setNewGroup('')
      setGroupNote(fill(words.groupCreated, { name }))
      set({ groupIds: [...d.groupIds, id] })
    })
  }

  return (
    <div className="df-offer-form">
      <Section n={1} title={words.sections.what}>
        {(d.type === 'products' || d.type === 'order') && (
          <>
            <div className="df-offer-row">
              <div className="df-offer-segment" role="radiogroup" aria-labelledby={ids.kind}>
                <span id={ids.kind} className="df-visually-hidden">
                  {words.kindLabel}
                </span>
                {(['percent', 'fixed'] as const).map((k) => (
                  <button key={k} type="button" role="radio" aria-checked={d.kind === k} disabled={disabled} onClick={() => set({ kind: k })}>
                    {k === 'percent' ? words.percentage : words.fixed}
                  </button>
                ))}
              </div>
              {!d.tiers.length && d.kind === 'percent' && (
                <label className="df-offer-inline">
                  <span>{words.percentLabel}</span>
                  <span className="df-offer-affixed">
                    <input value={d.percent} inputMode="numeric" readOnly={disabled} aria-invalid={Boolean(e.value) || undefined} onChange={(ev) => set({ percent: ev.target.value.replace(/\D/g, '') })} />
                    <span>%</span>
                  </span>
                </label>
              )}
            </div>
            {!d.tiers.length && d.kind === 'fixed' && <AmountBoxes label={words.amountLabel} value={d.amounts} onChange={(amounts) => set({ amounts })} facts={facts} invalid={Boolean(e.value)} disabled={disabled} />}
            <Problem text={e.value} />
            {d.type === 'products' && d.kind === 'fixed' && <span className="df-offers-sub">{words.perItemNote}</span>}
            {d.type === 'order' && d.kind === 'fixed' && !d.tiers.length && <span className="df-offers-sub">{words.orderFixedNote}</span>}
            {d.kind === 'percent' && facts.others.length > 0 && <span className="df-offers-sub">{words.multiPercentNote}</span>}
          </>
        )}

        {d.type === 'products' && (
          <>
            <span id={ids.target} className="df-offer-label">
              {words.appliesTo}
            </span>
            <RadioCards<Target>
              labelledBy={ids.target}
              className="df-offer-cards"
              value={d.target}
              disabled={disabled}
              onChange={(target) => set({ target })}
              options={(['products', 'filter', 'collection'] as const).map((t) => ({ value: t, label: words.targets[t].title, sub: words.targets[t].sub }))}
            />
            {d.target === 'products' && (
              <div className="df-offer-chips">
                <Chips ids={d.productIds} names={productNames} label={words.remove} disabled={disabled} onRemove={(id) => set({ productIds: d.productIds.filter((x) => x !== id) })} />
                {!disabled && (
                  <button type="button" className="df-button" onClick={() => onPick('productIds')}>
                    {words.chooseProducts}
                  </button>
                )}
                {d.productIds.length > 0 && <span className="df-offers-sub">{words.versionsNote}</span>}
              </div>
            )}
            {d.target === 'filter' &&
              (filter ? (
                <div className="df-offer-row">
                  <label className="df-offer-inline">
                    <span>{words.filter}</span>
                    <select value={filter.id} disabled={disabled} onChange={(ev) => set({ filterValueIds: lists.filters.find((f) => f.id === ev.target.value)?.values.slice(0, 1).map((v) => v.id) ?? [] })}>
                      {lists.filters.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="df-offer-inline">
                    <span>{words.tagged}</span>
                    <select value={d.filterValueIds[0] ?? ''} disabled={disabled} onChange={(ev) => set({ filterValueIds: ev.target.value ? [ev.target.value] : [] })}>
                      <option value="">{words.chooseValue}</option>
                      {filter.values.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {d.filterValueIds.length > 0 && <span className="df-offers-sub">{fill(words.filterNote, { value: filter.values.find((v) => v.id === d.filterValueIds[0])?.name ?? '' })}</span>}
                </div>
              ) : (
                <span className="df-offers-sub">
                  {words.noFilters}{' '}
                  <Link to="/collections" search={{ tab: 'filters' }}>
                    {words.goFilters}
                  </Link>
                </span>
              ))}
            {d.target === 'collection' && (
              <>
                <label className="df-offer-inline">
                  <span>{words.collection}</span>
                  <select value={d.collectionIds[0] ?? ''} disabled={disabled} onChange={(ev) => set({ collectionIds: ev.target.value ? [ev.target.value] : [] })}>
                    <option value="">{words.chooseCollection}</option>
                    {lists.collections.map((c) => (
                      <option key={c.id} value={c.id}>
                        {fill(words.collectionOption, { name: c.name, count: formatCount(c.products) })}
                      </option>
                    ))}
                  </select>
                </label>
                <span className="df-offers-sub">{words.collectionNote}</span>
              </>
            )}
            <Problem text={e.targets} />
            <fieldset className="df-offer-checks">
              <legend className="df-offer-label">{words.leaveOut}</legend>
              <label>
                <input type="checkbox" checked={d.excludeGiftCards} disabled={disabled} onChange={() => set({ excludeGiftCards: !d.excludeGiftCards })} />
                {words.giftCards}
              </label>
              <label>
                <input type="checkbox" checked={d.excludeOnSale} disabled={disabled} onChange={() => set({ excludeOnSale: !d.excludeOnSale })} />
                {words.onSale}
              </label>
            </fieldset>
          </>
        )}

        {d.type === 'order' && (
          <>
            <label className="df-offer-check">
              <input type="checkbox" checked={d.tiers.length > 0} disabled={disabled} onChange={() => set({ tiers: d.tiers.length ? [] : [{ off: d.kind === 'percent' ? '10' : '', minimum: '' }, { off: d.kind === 'percent' ? '15' : '', minimum: '' }], capOn: false })} />
              {words.tiers}
            </label>
            {d.tiers.length > 0 && (
              <div className="df-offer-tiers">
                {d.tiers.map((t, i) => (
                  <div key={i} className="df-offer-row">
                    <input value={t.off} inputMode="decimal" readOnly={disabled} aria-label={fill(words.tierOff, { n: String(i + 1) })} onChange={(ev) => set({ tiers: d.tiers.map((x, j) => (j === i ? { ...x, off: ev.target.value.replace(/[^\d.]/g, '') } : x)) })} />
                    <span>{fill(words.tierOver, { unit: d.kind === 'percent' ? '%' : facts.main })}</span>
                    <input value={t.minimum} inputMode="decimal" readOnly={disabled} aria-label={fill(words.tierMinimum, { n: String(i + 1) })} onChange={(ev) => set({ tiers: d.tiers.map((x, j) => (j === i ? { ...x, minimum: ev.target.value.replace(/[^\d.]/g, '') } : x)) })} />
                    <span>{facts.main}</span>
                    {!disabled && d.tiers.length > 2 && (
                      <button type="button" className="df-offer-remove" aria-label={fill(words.removeTier, { n: String(i + 1) })} onClick={() => set({ tiers: d.tiers.filter((_, j) => j !== i) })}>
                        <span aria-hidden="true">{words.removeGlyph}</span>
                      </button>
                    )}
                  </div>
                ))}
                {!disabled && d.tiers.length < 5 && (
                  <button type="button" className="df-button" onClick={() => set({ tiers: [...d.tiers, { off: '', minimum: '' }] })}>
                    {words.addTier}
                  </button>
                )}
                <span className="df-offers-sub">{words.tiersNote}</span>
                <Problem text={e.tiers} />
              </div>
            )}
          </>
        )}
        {(d.type === 'order' || d.type === 'products') && d.kind === 'percent' && !d.tiers.length && (
          <label className="df-offer-check">
            <input type="checkbox" checked={d.capOn} disabled={disabled} onChange={() => set({ capOn: !d.capOn })} />
            {words.cap}
            {d.capOn && (
              <span className="df-offer-affixed">
                <input value={d.cap} inputMode="decimal" readOnly={disabled} aria-label={words.capLabel} aria-invalid={Boolean(e.cap) || undefined} onChange={(ev) => set({ cap: ev.target.value.replace(/[^\d.]/g, '') })} />
                <span>{facts.main}</span>
              </span>
            )}
          </label>
        )}
        <Problem text={e.cap} />

        {d.type === 'bxgy' && (
          <div className="df-offer-bxgy">
            <div className="df-offer-row">
              <span>{words.buys}</span>
              <input className="df-offer-small" value={d.buyQuantity} inputMode="numeric" readOnly={disabled} aria-label={words.buysHow} onChange={(ev) => set({ buyQuantity: ev.target.value.replace(/\D/g, '') })} />
              <span>{words.of}</span>
              <Chips ids={d.buyIds} names={productNames} label={words.remove} disabled={disabled} onRemove={(id) => set({ buyIds: d.buyIds.filter((x) => x !== id) })} />
              {!disabled && (
                <button type="button" className="df-button" onClick={() => onPick('buyIds')}>
                  {d.buyIds.length ? words.change : words.chooseProducts}
                </button>
              )}
            </div>
            <Problem text={e.buy} />
            <div className="df-offer-row">
              <span>{words.gets}</span>
              <input className="df-offer-small" value={d.getQuantity} inputMode="numeric" readOnly={disabled} aria-label={words.getsHow} onChange={(ev) => set({ getQuantity: ev.target.value.replace(/\D/g, '') })} />
              <select aria-label={words.which} value={d.getSame ? 'same' : 'other'} disabled={disabled} onChange={(ev) => set({ getSame: ev.target.value === 'same', getIds: [] })}>
                <option value="same">{words.same}</option>
                <option value="other">{words.other}</option>
              </select>
              {!d.getSame && <Chips ids={d.getIds} names={productNames} label={words.remove} disabled={disabled} onRemove={(id) => set({ getIds: d.getIds.filter((x) => x !== id) })} />}
              {!d.getSame && !disabled && (
                <button type="button" className="df-button" onClick={() => onPick('getIds')}>
                  {words.chooseProducts}
                </button>
              )}
            </div>
            <Problem text={e.get} />
            <div className="df-offer-row">
              <span>{words.at}</span>
              <select aria-label={words.atLabel} value={d.getPercent === '100' ? 'free' : d.getPercent === '50' ? 'half' : 'percent'} disabled={disabled} onChange={(ev) => set({ getPercent: ev.target.value === 'free' ? '100' : ev.target.value === 'half' ? '50' : '30' })}>
                <option value="free">{words.free}</option>
                <option value="half">{words.half}</option>
                <option value="percent">{words.percentOff}</option>
              </select>
              {d.getPercent !== '100' && d.getPercent !== '50' && (
                <span className="df-offer-affixed">
                  <input value={d.getPercent} inputMode="numeric" readOnly={disabled} aria-label={words.getPercentLabel} onChange={(ev) => set({ getPercent: ev.target.value.replace(/\D/g, '') })} />
                  <span>%</span>
                </span>
              )}
            </div>
            <Problem text={e.value} />
            <p className="df-offer-note">{words.bxgyNote}</p>
            <label className="df-offer-check">
              <input type="checkbox" checked={d.oncePerOrder} disabled={disabled} onChange={() => set({ oncePerOrder: !d.oncePerOrder })} />
              {fill(words.oncePerOrder, { twice: String(((Number(d.buyQuantity) || 1) + (d.getSame ? Number(d.getQuantity) || 1 : 0)) * 2), twiceFree: String((Number(d.getQuantity) || 1) * 2) })}
            </label>
          </div>
        )}

        {d.type === 'shipping' && (
          <>
            <div className="df-offer-segment" role="radiogroup" aria-label={words.shipModes}>
              {(['free', 'off'] as const).map((k) => (
                <button key={k} type="button" role="radio" aria-checked={d.shipMode === k} disabled={disabled} onClick={() => set({ shipMode: k })}>
                  {fill(k === 'free' ? words.shipFree : words.shipOff, { ship })}
                </button>
              ))}
            </div>
            {d.shipMode === 'off' && <AmountBoxes label={fill(words.shipOffLabel, { ship })} value={d.amounts} onChange={(amounts) => set({ amounts })} facts={facts} invalid={Boolean(e.value)} disabled={disabled} />}
            <Problem text={e.value} />
            <span className="df-offers-sub">{fill(words.shipNote, { ship })}</span>
          </>
        )}
      </Section>

      <Section n={2} title={words.sections.how}>
        <span id={ids.how} className="df-visually-hidden">
          {words.sections.how}
        </span>
        <RadioCards<OfferDraft['trigger']>
          labelledBy={ids.how}
          className="df-offer-cards"
          value={d.trigger}
          disabled={disabled}
          onChange={(trigger) => set({ trigger, perCustomer: trigger === 'code' && d.perCustomer === '' ? '1' : d.perCustomer })}
          options={[
            { value: 'code', label: fill(words.how.code.title, { code: region.code }), sub: words.how.code.sub },
            { value: 'automatic', label: words.how.automatic.title, sub: words.how.automatic.sub },
          ]}
        />
        {d.trigger === 'code' && !d.singleUse && (
          <>
            <label className="df-offer-inline">
              <span>{words.codeLabel}</span>
              <span className="df-offer-row">
                <input className="df-offer-code-input" aria-label={words.codeLabel} value={d.code} readOnly={disabled} placeholder={words.codePlaceholder} autoCapitalize="characters" spellCheck={false} maxLength={32} aria-invalid={hasCodeError || undefined} onChange={(ev) => set({ code: ev.target.value.toUpperCase().replace(/\s/g, '') })} />
                {!disabled && (
                  <button type="button" className="df-button" onClick={() => set({ code: generateCode() })}>
                    {words.generate}
                  </button>
                )}
              </span>
            </label>
            {hasCodeError ? <Problem text={e.code} /> : <span className={code && !e.code ? 'df-offers-good' : 'df-offers-sub'}>{code && !e.code ? fill(words.codeOk, { code }) : words.codeHelp}</span>}
            {liveCode && code !== liveCode && <p className="df-offers-note df-offers-note--warning">{fill(words.codeChanged, { code: liveCode })}</p>}
          </>
        )}
        {d.trigger === 'code' && isNew && (
          <div className="df-offer-single">
            <label className="df-offer-check">
              <input type="checkbox" checked={d.singleUse} disabled={disabled} onChange={() => set({ singleUse: !d.singleUse, perCustomer: d.singleUse ? d.perCustomer : '1', totalUses: d.singleUse ? d.totalUses : '' })} />
              <strong>{words.singleUse}</strong>
            </label>
            {d.singleUse && (
              <>
                <div className="df-offer-row">
                  <label className="df-offer-inline">
                    <span>{words.batchCount}</span>
                    <input className="df-offer-small" value={d.batch.count} inputMode="numeric" readOnly={disabled} onChange={(ev) => set({ batch: { ...d.batch, count: ev.target.value.replace(/\D/g, '') } })} />
                  </label>
                  <label className="df-offer-inline">
                    <span>{words.batchPrefix}</span>
                    <input className="df-offer-small" value={d.batch.prefix} maxLength={12} readOnly={disabled} onChange={(ev) => set({ batch: { ...d.batch, prefix: ev.target.value.toUpperCase().replace(/\s/g, '') } })} />
                  </label>
                  <label className="df-offer-inline">
                    <span>{words.batchLength}</span>
                    <select value={d.batch.length} disabled={disabled} onChange={(ev) => set({ batch: { ...d.batch, length: ev.target.value } })}>
                      {['6', '8', '10'].map((l) => (
                        <option key={l} value={l}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <Problem text={e.batch} />
                <span className="df-offers-sub">{words.batchHelp}</span>
              </>
            )}
          </div>
        )}
        {d.trigger === 'code' && !isNew && d.singleUse && <span className="df-offers-sub">{words.singleUseNote}</span>}
        {d.trigger === 'automatic' && <span className="df-offers-sub">{words.automaticNote}</span>}

        <label className="df-offer-inline df-offer-wide">
          <span>{words.name}</span>
          <input value={d.name} readOnly={disabled} maxLength={120} aria-invalid={Boolean(e.name) || undefined} onChange={(ev) => set({ name: ev.target.value })} />
        </label>
        <Problem text={e.name} />
        <span className="df-offers-sub">
          {words.nameHelp} {words.namePreview} <span className="df-offer-name-line">{d.name.trim() || words.unnamed}</span>
        </span>
        {/test|do not use|don.t use|experiment|internal|tmp/i.test(d.name) && <p className="df-offers-note df-offers-note--warning">{words.nameWarn}</p>}
        <label className="df-offer-inline df-offer-wide">
          <span>{words.note}</span>
          <input value={d.note} readOnly={disabled} maxLength={120} placeholder={words.notePlaceholder} onChange={(ev) => set({ note: ev.target.value })} />
        </label>
      </Section>

      <Section n={3} title={words.sections.must}>
        <span id={ids.minimum} className="df-visually-hidden">
          {words.sections.must}
        </span>
        <RadioCards<Minimum>
          labelledBy={ids.minimum}
          className="df-offer-cards"
          value={d.minimum}
          disabled={disabled}
          onChange={(minimum) => set({ minimum })}
          options={(['none', 'amount', ...(d.type === 'products' ? (['these'] as const) : []), 'items'] as const).map((m) => ({ value: m, label: words.minimum[m].title, sub: words.minimum[m].sub }))}
        />
        {d.minimum === 'amount' && <AmountBoxes label={words.minimum.amount.title} value={d.minAmounts} onChange={(minAmounts) => set({ minAmounts })} facts={facts} invalid={Boolean(e.minimum)} disabled={disabled} />}
        {(d.minimum === 'items' || d.minimum === 'these') && (
          <label className="df-offer-inline">
            <span>{words.minimum[d.minimum].title}</span>
            <span className="df-offer-affixed">
              <input value={d.minQuantity} inputMode="numeric" readOnly={disabled} aria-invalid={Boolean(e.minimum) || undefined} onChange={(ev) => set({ minQuantity: ev.target.value.replace(/\D/g, '') })} />
              <span>{words.items}</span>
            </span>
          </label>
        )}
        <Problem text={e.minimum} />
        {andParts.length > 1 && <span className="df-offers-sub">{fill(words.andLine, { parts: formatList(andParts) })}</span>}
      </Section>

      <Section n={4} title={words.sections.who}>
        <span id={ids.who} className="df-visually-hidden">
          {words.sections.who}
        </span>
        <RadioCards<Who>
          labelledBy={ids.who}
          className="df-offer-cards"
          value={d.who}
          disabled={disabled}
          onChange={(who) => set({ who, countries: who === 'market' && !d.countries.length ? (markets[0]?.countries ?? []) : d.countries })}
          options={(['all', 'groups', 'first', 'customers', 'market'] as const).map((w) => ({ value: w, label: words.who[w].title, sub: words.who[w].sub }))}
        />
        {d.who === 'groups' && (
          <div className="df-offer-chips">
            {lists.groups.length === 0 && <span className="df-offers-sub">{words.noGroups}</span>}
            {lists.groups.map((g) => (
              <button key={g.id} type="button" className="df-chip" aria-pressed={d.groupIds.includes(g.id)} disabled={disabled} onClick={() => set({ groupIds: d.groupIds.includes(g.id) ? d.groupIds.filter((x) => x !== g.id) : [...d.groupIds, g.id] })}>
                {fill(words.groupChip, { name: g.name, count: formatCount(g.members) })}
              </button>
            ))}
            {!disabled && (
              <span className="df-offer-row">
                <input value={newGroup} aria-label={words.newGroupLabel} placeholder={words.newGroup} maxLength={60} onChange={(ev) => setNewGroup(ev.target.value)} />
                <button type="button" className="df-button" onClick={create}>
                  {words.createGroup}
                </button>
              </span>
            )}
            {groupNote && <span className="df-offers-good" role="status">{groupNote}</span>}
            {d.groupIds.length > 1 && <span className="df-offers-sub">{words.anyGroup}</span>}
            <Link to="/customers">{words.goCustomers}</Link>
          </div>
        )}
        {d.who === 'customers' && (
          <div className="df-offer-chips">
            <Chips ids={d.customerIds} names={customerNames} label={words.remove} disabled={disabled} onRemove={(id) => set({ customerIds: d.customerIds.filter((x) => x !== id) })} />
            {!disabled && d.customerIds.length < offerLimits.ids && (
              <CustomerSearch
                chosen={d.customerIds}
                onPick={(id, name) => {
                  onCustomerName(id, name)
                  set({ customerIds: [...d.customerIds, id] })
                }}
              />
            )}
          </div>
        )}
        {d.who === 'market' && (
          <label className="df-offer-inline">
            <span>{words.market}</span>
            <select value={marketOf?.id ?? ''} disabled={disabled} onChange={(ev) => set({ countries: markets.find((m) => m.id === ev.target.value)?.countries ?? [] })}>
              <option value="">{words.chooseMarket}</option>
              {markets.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <Problem text={e.who} />
      </Section>

      <When draft={d} set={set} errors={e} facts={facts} disabled={disabled} />

      <Section title={words.sections.others}>
        <fieldset className="df-offer-checks">
          <legend className="df-offer-label">{words.combinesTitle}</legend>
          <span className="df-offers-sub">{words.combinesHelp}</span>
          {(['product', 'order', 'shipping'] as const).map((k) => (
            <label key={k}>
              <input type="checkbox" checked={d.combines[k]} disabled={disabled} onChange={() => set({ combines: { ...d.combines, [k]: !d.combines[k] } })} />
              {fill(words.combines[k], { ship })}
            </label>
          ))}
        </fieldset>
      </Section>
    </div>
  )
}

const day = 86_400_000

/** "When and how often?" (K, L): dates in the store's time zone, quick picks, a weekly repeat and the limits. */
const When = ({ draft: d, set, errors: e, facts, disabled }: { draft: OfferDraft; set: FormProps['set']; errors: FormProps['errors']; facts: StoreFacts; disabled: boolean }) => {
  const zone = zoneName(facts.timeZone)
  const today = new Date()
  const date = (t: number) => localOf(new Date(t).toISOString(), facts.timeZone).slice(0, 10)
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(new Intl.DateTimeFormat('en-US', { timeZone: facts.timeZone, weekday: 'short' }).format(today))
  const toSaturday = (6 - weekday + 7) % 7 || 7
  const [y, m] = date(today.getTime()).split('-').map(Number)
  const monthEnd = new Date(Date.UTC(y ?? 2026, m ?? 1, 0)).toISOString().slice(0, 10)
  const quick = [
    { label: words.quick.weekend, starts: `${date(today.getTime() + toSaturday * day)}T00:00`, ends: `${date(today.getTime() + (toSaturday + 1) * day)}T23:59` },
    { label: words.quick.week, starts: '', ends: `${date(today.getTime() + 7 * day)}T23:59` },
    { label: words.quick.month, starts: '', ends: `${monthEnd}T23:59` },
  ]
  const days = [0, 1, 2, 3, 4, 5, 6]
  return (
    <Section n={5} title={words.sections.when} aside={<span className="df-offers-sub">{fill(words.timesIn, { zone })}</span>}>
      {!disabled && (
        <div className="df-offer-chips">
          {quick.map((q) => (
            <button key={q.label} type="button" className="df-chip" onClick={() => set({ startsAt: q.starts, endsAt: q.ends })}>
              {q.label}
            </button>
          ))}
        </div>
      )}
      <div className="df-offer-dates">
        <label className="df-offer-inline">
          <span>{words.starts}</span>
          <select value={d.startsAt ? 'date' : 'now'} disabled={disabled} onChange={(ev) => set({ startsAt: ev.target.value === 'date' ? `${date(today.getTime() + day)}T09:00` : '' })}>
            <option value="now">{words.startsNow}</option>
            <option value="date">{words.onDate}</option>
          </select>
          {d.startsAt && <input type="datetime-local" value={d.startsAt} readOnly={disabled} aria-label={words.startAt} onChange={(ev) => set({ startsAt: ev.target.value })} />}
        </label>
        <label className="df-offer-inline">
          <span>{words.ends}</span>
          <select value={d.endsAt ? 'date' : 'none'} disabled={disabled} onChange={(ev) => set({ endsAt: ev.target.value === 'date' ? `${date(today.getTime() + 7 * day)}T23:59` : '' })}>
            <option value="none">{words.noEnd}</option>
            <option value="date">{words.onDate}</option>
          </select>
          {d.endsAt && <input type="datetime-local" value={d.endsAt} readOnly={disabled} aria-label={words.endAt} aria-invalid={Boolean(e.ends) || undefined} onChange={(ev) => set({ endsAt: ev.target.value.endsWith('T00:00') ? ev.target.value.replace('T00:00', 'T23:59') : ev.target.value })} />}
          {d.endsAt && <span className="df-offers-sub">{fill(words.endHelp, { time: d.endsAt.slice(11), zone })}</span>}
        </label>
      </div>
      <Problem text={e.ends} />
      <div className="df-offer-repeat">
        <label className="df-offer-check">
          <input type="checkbox" checked={d.repeat !== null} disabled={disabled} onChange={() => set({ repeat: d.repeat ? null : { days: [5], from: '17:00', to: '21:00' } })} />
          <strong>{words.repeat}</strong> <span className="df-offers-sub">{words.repeatSub}</span>
        </label>
        {d.repeat && (
          <>
            <div className="df-offer-chips">
              {days.map((n) => (
                <button key={n} type="button" className="df-chip" aria-pressed={d.repeat?.days.includes(n) ?? false} disabled={disabled} onClick={() => d.repeat && set({ repeat: { ...d.repeat, days: d.repeat.days.includes(n) ? d.repeat.days.filter((x) => x !== n) : [...d.repeat.days, n] } })}>
                  {weekdayName(n)}
                </button>
              ))}
            </div>
            <div className="df-offer-row">
              <span>{words.from}</span>
              <input type="time" value={d.repeat.from} readOnly={disabled} aria-label={words.from} onChange={(ev) => d.repeat && set({ repeat: { ...d.repeat, from: ev.target.value } })} />
              <span>{words.to}</span>
              <input type="time" value={d.repeat.to} readOnly={disabled} aria-label={words.toLabel} onChange={(ev) => d.repeat && set({ repeat: { ...d.repeat, to: ev.target.value } })} />
              <span className="df-offers-sub">{zone}</span>
            </div>
            {d.repeat.days.length > 0 && <span className="df-offers-sub">{fill(words.repeatNote, { when: repeatText(d.repeat) })}</span>}
            <Problem text={e.repeat} />
          </>
        )}
      </div>
      <div className="df-offer-dates">
        <label className="df-offer-inline">
          <span>{words.total}</span>
          <span className="df-offer-row">
            <select value={d.totalUses ? 'n' : 'none'} disabled={disabled} onChange={(ev) => set({ totalUses: ev.target.value === 'n' ? '100' : '' })}>
              <option value="none">{words.unlimited}</option>
              <option value="n">{words.limitTo}</option>
            </select>
            {d.totalUses && <input className="df-offer-small" value={d.totalUses} inputMode="numeric" readOnly={disabled} aria-label={words.totalLabel} aria-invalid={Boolean(e.total) || undefined} onChange={(ev) => set({ totalUses: ev.target.value.replace(/\D/g, '') || '0' })} />}
          </span>
          <span className="df-offers-sub">{d.totalUses ? fill(words.totalStops, { count: d.totalUses }) : words.totalHelp}</span>
        </label>
        <label className="df-offer-inline">
          <span>{words.perCustomer}</span>
          <select value={d.perCustomer} disabled={disabled} onChange={(ev) => set({ perCustomer: ev.target.value })}>
            <option value="">{words.unlimited}</option>
            <option value="1">{words.once}</option>
            <option value="2">{words.twice}</option>
            <option value="3">{words.three}</option>
          </select>
          {d.perCustomer && <span className="df-offers-sub">{words.perCustomerHelp}</span>}
        </label>
      </div>
      <Problem text={e.total} />
      <Problem text={e.perCustomer} />
    </Section>
  )
}
