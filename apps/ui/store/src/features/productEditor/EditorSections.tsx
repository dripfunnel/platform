import { formatMoney } from '@dripfunnel/shared/format'
import { useId, useState, type ReactNode } from 'react'
import type { EditorProduct } from '../../api/productEditor'
import { fill, locale, messages } from '../../messages'
import { AssetImage } from '../common/AssetImage'
import { boxOf, gramsOf, priceRange, type Draft, type DraftProblem } from './draft'
import type { Update } from './EditorCards'

const words = messages.editor

/** A closed section shows a summary of what it holds; open, its fields (CatEditor's "sections"). */
export const Section = ({ title, summary, open, onToggle, problem, children }: { title: string; summary: string; open: boolean; onToggle: () => void; problem: boolean; children: ReactNode }) => {
  const id = useId()
  return (
    <section className={problem ? 'df-editor-section df-editor-section--problem' : 'df-editor-section'}>
      <button type="button" className="df-editor-section-head" aria-expanded={open} aria-controls={id} onClick={onToggle}>
        <span>
          <strong>{title}</strong>
          <span>{summary}</span>
        </span>
        <span aria-hidden="true">{open ? `${words.sections.close} ▴` : `${words.sections.open} ▾`}</span>
      </button>
      {open && (
        <div id={id} className="df-editor-section-body">
          {children}
        </div>
      )}
    </section>
  )
}

export const Field = ({ label, hint, problem, children }: { label: string; hint?: string; problem?: string | null; children: (id: string, describedBy: string | undefined) => ReactNode }) => {
  const id = useId()
  return (
    <div className="df-editor-field">
      <label htmlFor={id}>
        {label} {hint && <span className="df-editor-hint-inline">{hint}</span>}
      </label>
      {children(id, problem ? `${id}-p` : undefined)}
      {problem && (
        <span id={`${id}-p`} className="df-editor-problem">
          {problem}
        </span>
      )}
    </div>
  )
}

export const EditorSections = ({ draft, update, disabled, problems, taxClasses, storeFields, isLive, afterShipping, afterTax }: { draft: Draft; update: Update; disabled: boolean; problems: readonly DraftProblem[]; taxClasses: readonly { id: string; name: string; isDefault: boolean }[] | null; storeFields: boolean; isLive: boolean; afterShipping: ReactNode; afterTax: ReactNode }) => {
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const toggle = (key: string) => () => setOpen((o) => ({ ...o, [key]: !o[key] }))
  const single = draft.options.length === 0
  const units = words.sections.units[draft.units]
  const grams = gramsOf(draft.weight, draft.units)
  const shipSummary = typeof grams === 'number' ? [`${draft.weight} ${units.weight}`, draft.box && `${draft.box} ${units.box}`, draft.hsCode].filter(Boolean).join(' · ') : words.sections.shipEmpty
  const varies = (field: 'weight' | 'box' | 'hsCode') => (!draft.shippingChanged[field] && draft[field] === '' && draft.versions.length > 1 ? words.sections.varies : undefined)
  const setShipping = (field: 'weight' | 'box' | 'hsCode', text: string) => update((x) => ({ ...x, [field]: text, shippingChanged: { ...x.shippingChanged, [field]: true } }))
  const usual = taxClasses?.find((c) => c.isDefault)
  const chosen = taxClasses?.find((c) => c.id === draft.taxClassId)
  const shipProblem = problems.includes('weight') || problems.includes('box')
  return (
    <>
      {draft.kind === 'physical' && (
        <Section title={words.sections.ship} summary={shipSummary} open={!!open['ship'] || shipProblem} onToggle={toggle('ship')} problem={shipProblem}>
          <div className="df-editor-grid">
            <Field label={words.sections.weight} hint={units.weight} problem={problems.includes('weight') ? fill(words.sections.weightInvalid, { example: units.weightPlaceholder }) : null}>
              {(id, d) => <input id={id} inputMode="decimal" placeholder={varies('weight') ?? units.weightPlaceholder} value={draft.weight} readOnly={disabled} aria-describedby={d} aria-invalid={d !== undefined} onChange={(e) => setShipping('weight', e.target.value)} />}
            </Field>
            <Field label={words.sections.box} hint={units.box} problem={problems.includes('box') || boxOf(draft.box, draft.units) === 'invalid' ? fill(words.sections.boxInvalid, { example: units.boxPlaceholder }) : null}>
              {(id, d) => <input id={id} placeholder={varies('box') ?? units.boxPlaceholder} value={draft.box} readOnly={disabled} aria-describedby={d} aria-invalid={d !== undefined} onChange={(e) => setShipping('box', e.target.value)} />}
            </Field>
            <Field label={words.sections.code}>{(id) => <input id={id} maxLength={12} placeholder={varies('hsCode') ?? words.sections.codePlaceholder} value={draft.hsCode} readOnly={disabled} onChange={(e) => setShipping('hsCode', e.target.value)} />}</Field>
          </div>
        </Section>
      )}
      {afterShipping}
      {taxClasses && (
        <Section title={words.sections.tax} summary={chosen ? chosen.name : usual ? fill(words.sections.taxDefault, { name: usual.name }) : words.sections.taxNone} open={!!open['tax']} onToggle={toggle('tax')} problem={false}>
          <Field label={words.sections.tax}>
            {(id) => (
              <select id={id} value={draft.taxClassId ?? ''} disabled={disabled || !storeFields} onChange={(e) => update((x) => ({ ...x, taxClassId: e.target.value || null }))}>
                <option value="">{usual ? fill(words.sections.taxDefault, { name: usual.name }) : words.sections.taxNone}</option>
                {taxClasses
                  .filter((c) => !c.isDefault)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            )}
          </Field>
          <p className="df-editor-hint">{words.sections.taxNote}</p>
        </Section>
      )}
      {afterTax}
      <Section title={words.sections.seo} summary={fill(words.sections.seoSummary, { title: draft.seoTitle || draft.name || words.sections.seoFilled })} open={!!open['seo']} onToggle={toggle('seo')} problem={false}>
        <Field label={words.sections.seoTitle}>{(id) => <input id={id} maxLength={70} placeholder={draft.name} value={draft.seoTitle} readOnly={disabled} onChange={(e) => update((x) => ({ ...x, seoTitle: e.target.value }))} />}</Field>
        <Field label={words.sections.seoDescription}>{(id) => <textarea id={id} rows={2} maxLength={160} placeholder={draft.description.slice(0, 160)} value={draft.seoDescription} readOnly={disabled} onChange={(e) => update((x) => ({ ...x, seoDescription: e.target.value }))} />}</Field>
      </Section>
      <Section title={words.sections.more} summary={words.sections.moreSummary} open={!!open['more']} onToggle={toggle('more')} problem={false}>
        <div className="df-editor-grid">
          {single && (
            <Field label={words.sections.sku} hint={words.sections.skuHint}>
              {(id) => <input id={id} maxLength={64} value={draft.versions[0]?.sku ?? ''} readOnly={disabled} onChange={(e) => update((x) => ({ ...x, versions: x.versions.map((v, i) => (i === 0 ? { ...v, sku: e.target.value } : v)) }))} />}
            </Field>
          )}
          <Field label={words.sections.slug} hint={fill(words.sections.slugHint, { slug: draft.slug || '…' })}>
            {(id) => <input id={id} maxLength={120} value={draft.slug} readOnly={disabled} onChange={(e) => update((x) => ({ ...x, slug: e.target.value }))} />}
          </Field>
        </div>
        {isLive && <p className="df-editor-hint">{words.sections.slugWarn}</p>}
        <div className="df-editor-switches">
          {draft.kind === 'physical' && (
            <>
              <Switch label={words.sections.track} sub={draft.trackStock === null ? words.sections.varies : words.sections.trackSub} on={draft.trackStock ?? true} disabled={disabled} onChange={(on) => update((x) => ({ ...x, trackStock: on }))} />
              <Switch label={words.sections.oversell} sub={draft.continueSelling === null ? words.sections.varies : words.sections.oversellSub} on={draft.continueSelling ?? false} disabled={disabled} onChange={(on) => update((x) => ({ ...x, continueSelling: on }))} />
            </>
          )}
          <Switch label={words.sections.age} sub={words.sections.ageSub} on={draft.listing.ageRestricted} disabled={disabled} onChange={(on) => update((x) => ({ ...x, listing: { ...x.listing, ageRestricted: on } }))} />
          {draft.kind === 'physical' && <Switch label={words.sections.hazard} sub={words.sections.hazardSub} on={draft.listing.hazardous} disabled={disabled} onChange={(on) => update((x) => ({ ...x, listing: { ...x.listing, hazardous: on } }))} />}
        </div>
      </Section>
    </>
  )
}

const Switch = ({ label, sub, on, disabled, onChange }: { label: string; sub: string; on: boolean; disabled: boolean; onChange: (on: boolean) => void }) => (
  <label className="df-editor-switch">
    <input type="checkbox" role="switch" checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    <span>
      <strong>{label}</strong>
      <span>{sub}</span>
    </span>
  </label>
)

const needWords: Record<string, string> = messages.products.needs

/** The side panel: whether it shows, where it is ready to sell, and what a shopper sees. */
export const SidePanel = ({ draft, update, storeFields, canShow, readiness, currency, inclusive, approvalNote, badges }: { draft: Draft; update: Update; storeFields: boolean; canShow: boolean; readiness: EditorProduct['readiness'] | undefined; currency: string; inclusive: boolean | null; approvalNote: boolean; badges: readonly { id: string; label: string; rule: string }[] | null }) => {
  const range = priceRange(draft, currency)
  const money = (amount: number) => formatMoney({ amount, currency }, locale)
  const first = draft.options[0]
  return (
    <aside className="df-editor-side">
      {storeFields && (
        <section className="df-editor-card">
          <h2>{words.side.onStore}</h2>
          <div role="radiogroup" aria-label={words.side.onStore} className="df-editor-vis-options">
            {(['visible', 'hidden'] as const).map((key) => (
              <button key={key} type="button" role="radio" aria-checked={draft.visible === (key === 'visible')} className="df-editor-vis-option" disabled={!canShow && key === 'visible'} onClick={() => update((d) => ({ ...d, visible: key === 'visible' }))}>
                <strong>{words.side[key]}</strong>
                <span>{words.side[`${key}Sub`]}</span>
              </button>
            ))}
          </div>
        </section>
      )}
      {badges && badges.length > 0 && (
        <section className="df-editor-card">
          <h2>{words.side.badges}</h2>
          <div className="df-editor-chips">
            {badges.map((b) => {
              const manual = b.rule === 'manual'
              const on = manual && draft.listing.badgeIds.includes(b.id)
              return (
                <button key={b.id} type="button" className="df-editor-chip" aria-pressed={on} disabled={!manual || !storeFields} onClick={() => update((d) => ({ ...d, listing: { ...d.listing, badgeIds: on ? d.listing.badgeIds.filter((x) => x !== b.id) : [...d.listing.badgeIds, b.id] } }))}>
                  {on ? '✓ ' : ''}
                  {manual ? b.label : fill(words.side.badgeAuto, { name: b.label })}
                </button>
              )
            })}
          </div>
          <p className="df-editor-hint">{words.side.badgesNote}</p>
        </section>
      )}
      {approvalNote && (
        <div className="df-editor-note">
          <strong>{words.banner.approval}</strong> {words.banner.approvalBody}
        </div>
      )}
      {readiness !== null && (
        <section className="df-editor-card">
          <h2>{words.side.ready}</h2>
          {readiness === undefined ? (
            <p className="df-editor-hint">{words.side.readyAfterSave}</p>
          ) : (
            <ul className="df-editor-ready">
              {readiness.map((m) => (
                <li key={m.marketId} className={m.ready ? 'df-editor-ready--ok' : 'df-editor-ready--no'}>
                  <span>
                    <strong>{m.marketName}</strong>
                    <span>{m.ready ? words.side.readyOk : fill(words.side.readyAdd, { missing: m.missing.map((n) => needWords[n] ?? n).join(', ') })}</span>
                  </span>
                  <span aria-hidden="true">{m.ready ? '✓' : '⚠'}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="df-editor-hint">{words.side.readyNote}</p>
        </section>
      )}
      <section className="df-editor-card">
        <h2>{words.side.preview}</h2>
        <div className="df-editor-preview">
          {draft.photos[0] ? <AssetImage className="df-editor-preview-photo" url={draft.photos[0].url} alt="" placeholder={words.side.previewPhoto} /> : <div className="df-editor-preview-photo">{words.side.previewPhoto}</div>}
          <strong>{draft.name.trim() || words.side.previewName}</strong>
          <span>
            <strong>{range ? (range.low === range.high ? money(range.low) : `${money(range.low)} – ${money(range.high)}`) : money(0)}</strong>
            {inclusive !== null && <span className="df-editor-hint-inline"> {inclusive ? words.side.inclTax : words.side.plusTax}</span>}
          </span>
          {first && first.values.length > 0 && (
            <span className="df-editor-preview-pills">
              <span>{first.name}</span>
              {first.values.map((v) => (
                <span key={v.name} className="df-editor-pill">
                  {v.name}
                </span>
              ))}
            </span>
          )}
        </div>
      </section>
    </aside>
  )
}
