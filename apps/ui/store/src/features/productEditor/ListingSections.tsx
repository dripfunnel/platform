import { Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { loadProduct, type EditorProduct, type Facet, type ProductBasics, type ProductCollection } from '../../api/productEditor'
import { loadProducts } from '../../api/products'
import { fill, formatCount, messages, plural } from '../../messages'
import { legalFields, type Draft, type LegalField, type ListingSection } from './draft'
import type { Update } from './EditorCards'
import { Field, Section } from './EditorSections'

const words = messages.editor.sections

const maxHighlights = 5
const maxRelated = 4

export interface ListingChoices {
  /** Which listing sections the store has switched on (Settings › Catalogue), and filters, legal always. */
  shown: ReadonlySet<ListingSection>
  facets: readonly Facet[]
  sizeCharts: readonly { id: string; name: string }[]
  /** The merchant side's: its hand-picked collections, and the automatic ones the product is in; null for a supplier. */
  collections: { handPicked: readonly { id: string; name: string }[]; automatic: readonly ProductCollection[] } | null
}

/** The listing's choices: which sections the store switched on, its filters, charts and badges, and the collections. */
export interface EditorExtras {
  choices: ListingChoices
  badges: ProductBasics['badges'] | null
  memberships: ProductCollection[]
}

const toggle = <T,>(list: readonly T[], item: T): T[] => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item])

/** Collections & filters: the hand-picked collections it is in, the automatic ones it fell into, and its filter values. */
const CollectionsSection = ({ draft, update, disabled, choices }: { draft: Draft; update: Update; disabled: boolean; choices: ListingChoices }) => {
  const [open, setOpen] = useState(false)
  const picked = choices.collections?.handPicked.filter((c) => draft.collectionIds.includes(c.id)) ?? []
  const automatic = choices.collections?.automatic ?? []
  const summary = [picked.length > 0 ? fill(words.collIn, { names: picked.map((c) => c.name).join(', ') }) : '', automatic.length > 0 ? fill(words.collAlso, { names: automatic.map((c) => c.name).join(', ') }) : ''].filter(Boolean).join(' · ') || words.collEmpty
  return (
    <Section title={words.coll} summary={summary} open={open} onToggle={() => setOpen((o) => !o)} problem={false}>
      {choices.collections && (
        <div className="df-editor-group">
          <h3>{words.handPicked}</h3>
          {choices.collections.handPicked.length === 0 ? (
            <p className="df-editor-hint">{words.handPickedNone}</p>
          ) : (
            <div className="df-editor-chips">
              {choices.collections.handPicked.map((c) => {
                const on = draft.collectionIds.includes(c.id)
                return (
                  <button key={c.id} type="button" className="df-editor-chip" aria-pressed={on} disabled={disabled} onClick={() => update((d) => ({ ...d, collectionIds: toggle(d.collectionIds, c.id) }))}>
                    {on ? '✓ ' : ''}
                    {c.name}
                  </button>
                )
              })}
            </div>
          )}
          {automatic.length > 0 && <p className="df-editor-hint">{fill(words.automaticAlso, { names: automatic.map((c) => c.name).join(', ') })}</p>}
        </div>
      )}
      <div className="df-editor-group">
        <h3>{words.filters}</h3>
        {choices.facets.length === 0 && <p className="df-editor-hint">{words.filtersNone}</p>}
        {choices.facets.map((f) => (
          <div key={f.id} className="df-editor-facet">
            <span>
              {f.name}
              {!f.shopperVisible && <span className="df-editor-hint-inline"> · {words.internal}</span>}
            </span>
            <div className="df-editor-chips">
              {f.values.map((v) => {
                const on = draft.filterValueIds.includes(v.id)
                return (
                  <button key={v.id} type="button" className="df-editor-chip" aria-pressed={on} disabled={disabled} onClick={() => update((d) => ({ ...d, filterValueIds: toggle(d.filterValueIds, v.id) }))}>
                    {v.name}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
        <p className="df-editor-hint">{words.filtersHelp}</p>
      </div>
    </Section>
  )
}

const SizeChartSection = ({ draft, update, disabled, charts }: { draft: Draft; update: Update; disabled: boolean; charts: readonly { id: string; name: string }[] }) => {
  const [open, setOpen] = useState(false)
  const chosen = charts.find((c) => c.id === draft.sizeChartId)
  return (
    <Section title={words.chart} summary={chosen ? chosen.name : words.chartEmpty} open={open} onToggle={() => setOpen((o) => !o)} problem={false}>
      <Field label={words.chart}>
        {(id) => (
          <select id={id} value={draft.sizeChartId ?? ''} disabled={disabled} onChange={(e) => update((d) => ({ ...d, sizeChartId: e.target.value || null }))}>
            <option value="">{words.chartNone}</option>
            {charts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Link className="df-editor-link" to="/collections">
        {words.chartManage}
      </Link>
    </Section>
  )
}

const SpecsSection = ({ draft, update, disabled, specs, highlights }: { draft: Draft; update: Update; disabled: boolean; specs: boolean; highlights: boolean }) => {
  const [open, setOpen] = useState(false)
  const l = draft.listing
  const setListing = (change: (l: Draft['listing']) => Draft['listing']) => update((d) => ({ ...d, listing: change(d.listing) }))
  const filled = l.highlights.filter((h) => h.trim()).length
  const title = specs && highlights ? words.specs : specs ? words.specsOnly : words.highlightsOnly
  const summary = l.specs.length > 0 || filled > 0 ? fill(words.specsSummary, { specs: formatCount(l.specs.length), highlights: formatCount(filled) }) : words.specsEmpty
  return (
    <Section title={title} summary={summary} open={open} onToggle={() => setOpen((o) => !o)} problem={false}>
      {specs && (
        <div className="df-editor-group">
          {l.specs.map((sp, i) => (
            <div key={i} className="df-editor-pair">
              <input aria-label={`${words.specName} ${i + 1}`} maxLength={60} placeholder={words.specNamePlaceholder} value={sp.name} readOnly={disabled} onChange={(e) => setListing((x) => ({ ...x, specs: x.specs.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)) }))} />
              <input aria-label={`${words.specValue} ${i + 1}`} maxLength={200} placeholder={words.specValuePlaceholder} value={sp.value} readOnly={disabled} onChange={(e) => setListing((x) => ({ ...x, specs: x.specs.map((y, j) => (j === i ? { ...y, value: e.target.value } : y)) }))} />
              {!disabled && (
                <button type="button" className="df-editor-link" aria-label={fill(words.specRemove, { name: sp.name || String(i + 1) })} onClick={() => setListing((x) => ({ ...x, specs: x.specs.filter((_, j) => j !== i) }))}>
                  ×
                </button>
              )}
            </div>
          ))}
          {!disabled && l.specs.length < 50 && (
            <button type="button" className="df-editor-link" onClick={() => setListing((x) => ({ ...x, specs: [...x.specs, { name: '', value: '', filterValueId: null }] }))}>
              {words.specAdd}
            </button>
          )}
        </div>
      )}
      {highlights && (
        <div className="df-editor-group">
          <h3>{fill(words.highlightsTitle, { count: formatCount(l.highlights.length) })}</h3>
          {l.highlights.map((h, i) => (
            <div key={i} className="df-editor-pair df-editor-pair--one">
              <input aria-label={fill(words.highlightLabel, { n: String(i + 1) })} maxLength={120} placeholder={words.highlightPlaceholder} value={h} readOnly={disabled} onChange={(e) => setListing((x) => ({ ...x, highlights: x.highlights.map((y, j) => (j === i ? e.target.value : y)) }))} />
              {!disabled && (
                <button type="button" className="df-editor-link" aria-label={fill(words.highlightRemove, { n: String(i + 1) })} onClick={() => setListing((x) => ({ ...x, highlights: x.highlights.filter((_, j) => j !== i) }))}>
                  ×
                </button>
              )}
            </div>
          ))}
          {!disabled && l.highlights.length < maxHighlights && (
            <button type="button" className="df-editor-link" onClick={() => setListing((x) => ({ ...x, highlights: [...x.highlights, ''] }))}>
              {words.highlightAdd}
            </button>
          )}
        </div>
      )}
    </Section>
  )
}

const FaqsSection = ({ draft, update, disabled }: { draft: Draft; update: Update; disabled: boolean }) => {
  const [open, setOpen] = useState(false)
  const faqs = draft.listing.faqs
  const setFaqs = (change: (f: typeof faqs) => typeof faqs) => update((d) => ({ ...d, listing: { ...d.listing, faqs: change(d.listing.faqs) } }))
  return (
    <Section title={words.faqs} summary={faqs.length > 0 ? fill(plural(words.faqsSummary, faqs.length), { count: formatCount(faqs.length) }) : words.faqsEmpty} open={open} onToggle={() => setOpen((o) => !o)} problem={false}>
      {faqs.map((f, i) => (
        <div key={i} className="df-editor-faq">
          <div className="df-editor-pair df-editor-pair--one">
            <input aria-label={`${words.faqQuestion} ${i + 1}`} maxLength={200} placeholder={words.faqQuestion} value={f.question} readOnly={disabled} onChange={(e) => setFaqs((x) => x.map((y, j) => (j === i ? { ...y, question: e.target.value } : y)))} />
            {!disabled && (
              <button type="button" className="df-editor-link" aria-label={`${words.faqRemove} ${i + 1}`} onClick={() => setFaqs((x) => x.filter((_, j) => j !== i))}>
                ×
              </button>
            )}
          </div>
          <textarea aria-label={`${words.faqAnswer} ${i + 1}`} rows={2} maxLength={2000} placeholder={words.faqAnswer} value={f.answer} readOnly={disabled} onChange={(e) => setFaqs((x) => x.map((y, j) => (j === i ? { ...y, answer: e.target.value } : y)))} />
        </div>
      ))}
      {!disabled && faqs.length < 20 && (
        <div className="df-editor-chips">
          <button type="button" className="df-editor-link" onClick={() => setFaqs((x) => [...x, { question: '', answer: '' }])}>
            {words.faqAdd}
          </button>
          {words.faqSuggest
            .filter((q) => !faqs.some((f) => f.question === q))
            .map((q) => (
              <button key={q} type="button" className="df-editor-chip" onClick={() => setFaqs((x) => [...x, { question: q, answer: '' }])}>
                + {q}
              </button>
            ))}
        </div>
      )}
    </Section>
  )
}

/** Related products: automatic from the same collection, or up to four picked by name. */
const RelatedSection = ({ draft, update, disabled, productId }: { draft: Draft; update: Update; disabled: boolean; productId: string | null }) => {
  const [open, setOpen] = useState(false)
  const [names, setNames] = useState<Record<string, string>>({})
  const [search, setSearch] = useState('')
  const [found, setFound] = useState<{ id: string; name: string }[]>([])
  const ids = draft.listing.relatedIds
  const setIds = (next: string[]) => update((d) => ({ ...d, listing: { ...d.listing, relatedIds: next } }))
  useEffect(() => {
    const unknown = ids.filter((id) => names[id] === undefined)
    if (!open || unknown.length === 0) return
    void Promise.all(unknown.map((id) => loadProduct(id).catch(() => null))).then((products) =>
      setNames((n) => ({ ...n, ...Object.fromEntries(products.filter((p): p is EditorProduct => p !== null).map((p) => [p.id, p.name])) })),
    )
  }, [open, ids, names])
  useEffect(() => {
    const q = search.trim()
    if (q.length < 2) return setFound([])
    const timer = setTimeout(() => void loadProducts({ filter: 'all', search: q, supplier: '', sort: 'name' }).then((page) => setFound(page.rows.filter((r) => r.id !== productId).map((r) => ({ id: r.id, name: r.name }))), () => setFound([])), 300)
    return () => clearTimeout(timer)
  }, [search, productId])
  const summary = ids.length === 0 ? words.relatedSummaryAuto : fill(plural(words.relatedPicked, ids.length), { count: formatCount(ids.length) })
  return (
    <Section title={words.related} summary={summary} open={open} onToggle={() => setOpen((o) => !o)} problem={false}>
      <label className="df-editor-switch">
        <input type="checkbox" checked={ids.length === 0} disabled={disabled || ids.length === 0} onChange={() => setIds([])} />
        <span>{words.relatedAuto}</span>
      </label>
      {ids.length > 0 && (
        <div className="df-editor-chips">
          {ids.map((id) => (
            <span key={id} className="df-editor-value">
              {names[id] ?? '…'}
              {!disabled && (
                <button type="button" aria-label={fill(words.relatedRemove, { name: names[id] ?? '' })} onClick={() => setIds(ids.filter((x) => x !== id))}>
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      {!disabled && ids.length < maxRelated && (
        <>
          <input type="search" className="df-editor-versions-search" aria-label={words.relatedSearch} placeholder={words.relatedSearch} value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="df-editor-chips">
            {found
              .filter((p) => !ids.includes(p.id))
              .slice(0, 8)
              .map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="df-editor-chip"
                  onClick={() => {
                    setNames((n) => ({ ...n, [p.id]: p.name }))
                    setIds([...ids, p.id])
                  }}
                >
                  + {p.name}
                </button>
              ))}
          </div>
        </>
      )}
      <p className="df-editor-hint">{words.relatedHelp}</p>
    </Section>
  )
}

/**
 * Legal & safety (never a paid feature): the details a market says are missing, and any already given. A supplier,
 * which reads no market, sees all three; each is kept for every region, which meets any country's need.
 */
const LegalSection = ({ draft, update, disabled, readiness }: { draft: Draft; update: Update; disabled: boolean; readiness: EditorProduct['readiness'] | undefined }) => {
  const [open, setOpen] = useState(false)
  const legal = draft.listing.legal
  const missingIn = (field: LegalField) => (readiness ?? []).filter((m) => m.missing.includes(field)).map((m) => m.marketName)
  const shown = legalFields.filter((f) => !readiness || legal[f].trim() !== '' || missingIn(f).length > 0)
  const short = (readiness ?? []).filter((m) => m.missing.some((n) => (legalFields as readonly string[]).includes(n))).map((m) => m.marketName)
  if (draft.kind !== 'physical') return null
  return (
    <Section title={words.legal} summary={short.length > 0 ? fill(words.legalSummaryMissing, { markets: short.join(', ') }) : words.legalSummaryOk} open={open || short.length > 0} onToggle={() => setOpen((o) => !o)} problem={false}>
      {shown.map((field) => {
        const missing = missingIn(field)
        return (
          <Field key={field} label={words.legalFields[field]} hint={missing.length > 0 ? fill(words.legalNeeded, { markets: missing.join(', ') }) : words.legalOptional}>
            {(id) => <input id={id} maxLength={2000} placeholder={words.legalPlaceholders[field]} value={legal[field]} readOnly={disabled} onChange={(e) => update((d) => ({ ...d, listing: { ...d.listing, legal: { ...d.listing.legal, [field]: e.target.value } } }))} />}
          </Field>
        )
      })}
      <p className="df-editor-hint">{words.legalHelp}</p>
    </Section>
  )
}

type ListingProps = { draft: Draft; update: Update; disabled: boolean; choices: ListingChoices; productId: string | null; readiness: EditorProduct['readiness'] | undefined }

/** Collections & filters, which CatEditor puts right after Shipping. */
export const CollectionsPart = ({ draft, update, disabled, choices }: ListingProps) => (choices.collections || choices.facets.length > 0 ? <CollectionsSection draft={draft} update={update} disabled={disabled} choices={choices} /> : null)

/** The rest of the listing, between the tax category and the search listing, in CatEditor's order. */
export const ListingSections = ({ draft, update, disabled, choices, productId, readiness }: ListingProps) => (
  <>
    {choices.shown.has('sizeCharts') && draft.kind === 'physical' && <SizeChartSection draft={draft} update={update} disabled={disabled} charts={choices.sizeCharts} />}
    {(choices.shown.has('specs') || choices.shown.has('highlights')) && <SpecsSection draft={draft} update={update} disabled={disabled} specs={choices.shown.has('specs')} highlights={choices.shown.has('highlights')} />}
    {choices.shown.has('faqs') && <FaqsSection draft={draft} update={update} disabled={disabled} />}
    {choices.shown.has('related') && <RelatedSection draft={draft} update={update} disabled={disabled} productId={productId} />}
    <LegalSection draft={draft} update={update} disabled={disabled} readiness={readiness} />
  </>
)
