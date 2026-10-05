import { isApiError } from '@dripfunnel/shared/graphql'
import { ConfirmDialog, Icon, type ConfirmDialogProps } from '@dripfunnel/shared/ui'
import { Link } from '@tanstack/react-router'
import { useEffect, useId, useRef, useState } from 'react'
import { deleteSizeChart, loadSizeChart, saveSizeChart, type SizeChart, type SizeChartSummary } from '../../api/sizeCharts'
import { fill, formatCount, messages, plural } from '../../messages'
import { chartInput, chartProblem, draftOfChart, inUnit, isChartDirty, noValue, templates, withMeasurement, withoutColumn, withRow, withSystems, type ChartDraft, type TemplateKey } from './sizeChartDraft'

const words = messages.collections.charts

/** A store's or a supplier's own charts stop here (catalogListing.ts maxSizeCharts). */
const maxSizeCharts = 200

type Ask = Omit<ConfirmDialogProps, 'open' | 'onCancel' | 'cancelLabel'> & { cancelLabel?: string }
type Selected = { kind: 'none' } | { kind: 'loading'; id: string } | { kind: 'failed'; id: string } | { kind: 'ready'; draft: ChartDraft; saved: ChartDraft; products: number }

const refusalOf = (error: unknown): string => (isApiError(error) ? ((words.refused as Record<string, string>)[error.code] ?? words.refused.other) : words.refused.other)

export interface SizeChartsTabProps {
  /** The caller's own charts. */
  charts: readonly SizeChartSummary[]
  canEdit: boolean
  /** Settings › Catalogue's switch, and whether the plan has charts (null: a supplier, told only whether they're on). */
  feature: { enabled: boolean; inPlan: boolean | null }
  /** Only the Owner sees a plan prompt (P11). */
  owner: boolean
  unit: 'cm' | 'in'
  india: boolean
  /** Something to say, nothing saved. */
  onToast: (text: string) => void
  /** A chart made, saved or deleted: the list reloads. */
  onSaved: (text: string) => void
  read?: (id: string) => Promise<SizeChart | null>
}

const TemplatePicker = ({ unit, india, onPick, onCancel }: { unit: 'cm' | 'in'; india: boolean; onPick: (key: TemplateKey) => void; onCancel: () => void }) => {
  const ref = useRef<HTMLDialogElement>(null)
  const id = useId()
  const [pick, setPick] = useState<TemplateKey>('tops')
  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal?.()
  }, [])
  return (
    <dialog ref={ref} className="df-dialog df-chart-start" aria-labelledby={`${id}-t`} onCancel={(e) => (e.preventDefault(), onCancel())}>
      <h2 id={`${id}-t`}>{words.startTitle}</h2>
      <p>{fill(words.startBody, { unit: unit === 'in' ? words.unitIn : words.unitCm })}</p>
      <fieldset>
        <legend className="df-visually-hidden">{words.startTitle}</legend>
        {templates(unit, india).map((t) => (
          <label key={t.key} className={pick === t.key ? 'df-chart-template df-chart-template--on' : 'df-chart-template'}>
            <input type="radio" name={`${id}-pick`} checked={pick === t.key} onChange={() => setPick(t.key)} />
            <span>
              <strong>{words.templates[t.key]}</strong>
              <span>{words.templates[`${t.key}Sub`]}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="df-actions">
        <button type="button" className="df-button" onClick={onCancel}>
          {words.cancel}
        </button>
        <button type="button" className="df-button df-button--primary" onClick={() => onPick(pick)}>
          {words.create}
        </button>
      </div>
    </dialog>
  )
}

/** CatSizeCharts: the caller's charts on the left; the one picked as an editable grid, its note and a shopper view. */
export const SizeChartsTab = ({ charts, canEdit, feature, owner, unit, india, onToast, onSaved, read = loadSizeChart }: SizeChartsTabProps) => {
  const formId = useId()
  const [selected, setSelected] = useState<Selected>({ kind: 'none' })
  const [ask, setAsk] = useState<Ask | null>(null)
  const [starting, setStarting] = useState(false)
  const [preview, setPreview] = useState(false)
  const [busy, setBusy] = useState(false)
  const [tried, setTried] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const open = (id: string) => {
    setSelected({ kind: 'loading', id })
    setPreview(false)
    setTried(false)
    setFailure(null)
    void read(id).then(
      (c) => (c ? setSelected({ kind: 'ready', draft: draftOfChart(c), saved: draftOfChart(c), products: c.products }) : setSelected({ kind: 'none' })),
      () => setSelected({ kind: 'failed', id }),
    )
  }
  // The first chart opens with the tab, as the prototype's does; later picks go through `choose`.
  useEffect(() => {
    const id = charts[0]?.id
    if (id) open(id)
  }, [])

  const dirty = selected.kind === 'ready' && isChartDirty(selected.draft, selected.saved)
  const choose = (id: string) =>
    dirty ? setAsk({ title: words.leaveTitle, target: '', consequence: words.leaveBody, confirmLabel: words.discard, cancelLabel: words.keep, danger: true, onConfirm: () => open(id) }) : open(id)

  const own = charts.length
  const atLimit = own >= maxSizeCharts
  const blocked = feature.inPlan === false || (feature.inPlan === null && !feature.enabled)
  const startNew = () => (atLimit ? onToast(words.atLimit) : setStarting(true))

  const create = async (input: ReturnType<typeof chartInput>, toast: string) => {
    setBusy(true)
    try {
      const made = await saveSizeChart(null, null, input)
      onSaved(toast)
      open(made.id)
    } catch (error) {
      onToast(refusalOf(error))
    } finally {
      setBusy(false)
    }
  }

  const fromTemplate = (key: TemplateKey) => {
    setStarting(false)
    const t = templates(unit, india).find((x) => x.key === key)
    if (t) void create(chartInput({ id: null, revision: null, name: words.newName[key], unit, ...t.chart, fitNotes: '', howToMeasure: [], modelInfo: null }), words.created)
  }

  const head = (
    <div className="df-charts-head">
      <span>
        <strong>{words.title}</strong> <span className={atLimit ? 'df-charts-meter df-charts-meter--full' : 'df-charts-meter'}>{fill(words.meter, { count: formatCount(own), limit: formatCount(maxSizeCharts) })}</span>
      </span>
      {canEdit && !blocked && (
        <button type="button" className="df-button df-button--primary df-button--small" disabled={busy || atLimit} onClick={startNew}>
          {atLimit ? words.limit : words.new}
        </button>
      )}
    </div>
  )

  const list = (
    <nav className="df-charts-list" aria-label={words.listLabel}>
      {head}
      {feature.inPlan !== null && !feature.enabled && <p className="df-charts-off">{words.offNote}</p>}
      {feature.inPlan === false && (
        <p className="df-charts-off">
          {owner ? words.notInPlanOwner : words.notInPlan}{' '}
          {owner && (
            <Link to="/billing" className="df-coll-link">
              {words.seePlans}
            </Link>
          )}
        </p>
      )}
      {feature.inPlan === null && !feature.enabled && <p className="df-charts-off">{words.notInPlanSupplier}</p>}
      {charts.length === 0 && <p className="df-charts-empty">{words.empty}</p>}
      <ul>
        {charts.map((c) => {
          const current = (selected.kind === 'ready' ? selected.draft.id : selected.kind === 'none' ? null : selected.id) === c.id
          return (
            <li key={c.id}>
              <button type="button" aria-current={current ? 'true' : undefined} className="df-charts-item" onClick={() => choose(c.id)}>
                <strong>{c.name}</strong>
                <span>{fill(plural(words.sub, c.products), { count: formatCount(c.products), unit: c.unit === 'in' ? words.unitIn : words.unitCm })}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )

  if (selected.kind !== 'ready')
    return (
      <div className="df-charts">
        {list}
        {selected.kind === 'loading' && <p className="df-charts-pick">{words.loading}</p>}
        {selected.kind === 'failed' && (
          <div className="df-charts-pick" role="alert">
            <p>{words.chartFailed}</p>
            <button type="button" className="df-button" onClick={() => open(selected.id)}>
              {words.retry}
            </button>
          </div>
        )}
        {selected.kind === 'none' && <p className="df-charts-pick">{words.pick}</p>}
        {!canEdit && <p className="df-colls-note">{words.viewOnly}</p>}
        {starting && <TemplatePicker unit={unit} india={india} onPick={fromTemplate} onCancel={() => setStarting(false)} />}
        {ask && <ConfirmDialog key={`${ask.title}|${ask.target}`} cancelLabel={words.cancel} {...ask} open onCancel={() => setAsk(null)} onConfirm={(...args) => { setAsk(null); ask.onConfirm(...args) }} />}
      </div>
    )

  const { draft: d, products } = selected
  const ro = !canEdit || busy
  const set = (next: ChartDraft) => setSelected({ ...selected, draft: next })
  const columns = [...d.systems, ...d.measurements]
  const problem = chartProblem(d)
  const setHead = (i: number, value: string) =>
    set(i < d.systems.length ? { ...d, systems: d.systems.map((s, j) => (j === i ? value : s)) } : { ...d, measurements: d.measurements.map((m, j) => (j + d.systems.length === i ? value : m)) })
  const setCell = (row: number, col: number, value: string) => set({ ...d, rows: d.rows.map((r, i) => (i === row ? (col < 0 ? { ...r, size: value } : { ...r, values: r.values.map((v, j) => (j === col ? value : v)) }) : r)) })

  const commit = async () => {
    setBusy(true)
    setFailure(null)
    try {
      const done = await saveSizeChart(d.id, d.revision, chartInput(d))
      const next = { ...d, revision: done.revision }
      setSelected({ kind: 'ready', draft: next, saved: next, products })
      onSaved(products > 0 ? fill(plural(words.savedOn, products), { name: d.name.trim(), count: formatCount(products) }) : fill(words.saved, { name: d.name.trim() }))
    } catch (error) {
      setFailure(refusalOf(error))
    } finally {
      setBusy(false)
    }
  }
  const copy = () => (atLimit ? onToast(words.atLimit) : void create({ ...chartInput(d), name: fill(words.copySuffix, { name: d.name.trim() }).slice(0, 80) }, words.copied))
  const save = () => {
    if (problem) return setTried(true)
    if (products > 1)
      return setAsk({
        title: fill(words.changeAllTitle, { count: formatCount(products) }),
        target: d.name,
        consequence: words.changeAllBody,
        confirmLabel: words.next,
        choices: [{ key: 'how', label: words.how, options: [{ value: 'all', label: fill(words.changeAll, { count: formatCount(products) }) }, { value: 'copy', label: words.copyInstead }], initial: 'all', error: () => null }],
        onConfirm: (_, __, picks) => (picks['how'] === 'copy' ? copy() : void commit()),
      })
    void commit()
  }
  const remove = () =>
    setAsk({
      title: fill(words.deleteTitle, { name: d.name }),
      target: d.name,
      consequence: products === 0 ? words.deleteNone : fill(plural(words.deleteBody, products), { count: formatCount(products) }),
      confirmLabel: words.deleteConfirm,
      danger: true,
      onConfirm: () =>
        void (async () => {
          if (!d.id) return
          setBusy(true)
          try {
            await deleteSizeChart(d.id)
            setSelected({ kind: 'none' })
            onSaved(words.deleted)
          } catch (error) {
            onToast(refusalOf(error))
          } finally {
            setBusy(false)
          }
        })(),
    })

  const grid = { gridTemplateColumns: `repeat(${columns.length + 1}, minmax(110px, 1fr)) ${canEdit ? '44px' : ''}`, minWidth: `${(columns.length + 1) * 110 + (canEdit ? 44 : 0)}px` }

  return (
    <div className="df-charts">
      {list}
      <section className="df-chart" aria-labelledby={`${formId}-name`}>
        <div className="df-chart-top">
          <label htmlFor={`${formId}-name`} className="df-visually-hidden">
            {words.name}
          </label>
          <input id={`${formId}-name`} className="df-chart-name" value={d.name} readOnly={ro} maxLength={80} aria-invalid={tried && problem === 'name'} onChange={(e) => set({ ...d, name: e.target.value })} />
          <span className="df-chart-units" role="group" aria-label={words.units}>
            {(['cm', 'in'] as const).map((u) => (
              <button
                key={u}
                type="button"
                aria-pressed={d.unit === u}
                disabled={ro}
                onClick={() => {
                  if (u === d.unit) return
                  set(inUnit(d, u))
                  onToast(words.converted[u])
                }}
              >
                {u === 'cm' ? words.unitCm : words.unitIn}
              </button>
            ))}
          </span>
          <button type="button" className="df-button df-button--small" aria-expanded={preview} onClick={() => setPreview((p) => !p)}>
            {preview ? words.hideShopperView : words.shopperView}
          </button>
        </div>
        {products > 1 && <p className="df-chart-warn">{fill(words.usedMany, { count: formatCount(products) })}</p>}
        {failure && (
          <p className="df-coll-failure" role="alert">
            {failure}
          </p>
        )}
        <div className="df-chart-grid" role="table" aria-label={d.name}>
          <div role="row" className="df-chart-head" style={grid}>
            <span role="columnheader">{words.sizeHead}</span>
            {columns.map((h, i) => (
              <span role="columnheader" key={i}>
                <input aria-label={fill(words.headCell, { n: String(i + 2) })} value={h} readOnly={ro} maxLength={40} aria-invalid={tried && problem === 'columns' && h.trim() === ''} onChange={(e) => setHead(i, e.target.value)} />
                {canEdit && (i < d.systems.length || d.measurements.length > 1) && (
                  <button type="button" aria-label={fill(words.removeColumn, { name: h || String(i + 2) })} disabled={busy} onClick={() => set(withoutColumn(d, i))}>
                    <Icon name="close" size={12} />
                  </button>
                )}
              </span>
            ))}
            {canEdit && <span aria-hidden="true" />}
          </div>
          {d.rows.map((r, i) => (
            <div role="row" key={i} className="df-chart-row" style={grid}>
              <span role="rowheader">
                <input aria-label={fill(words.sizeCell, { n: String(i + 1) })} value={r.size} readOnly={ro} maxLength={20} placeholder={noValue} aria-invalid={tried && problem === 'sizes' && r.size.trim() === ''} onChange={(e) => setCell(i, -1, e.target.value)} />
              </span>
              {r.values.map((v, j) => (
                <span role="cell" key={j}>
                  <input aria-label={fill(words.cell, { size: r.size || String(i + 1), column: columns[j] ?? '' })} value={v} readOnly={ro} maxLength={20} placeholder={noValue} onChange={(e) => setCell(i, j, e.target.value)} />
                </span>
              ))}
              {canEdit && (
                <span role="cell">
                  <button type="button" aria-label={fill(words.removeRow, { size: r.size || String(i + 1) })} disabled={busy || d.rows.length === 1} onClick={() => set({ ...d, rows: d.rows.filter((_, j) => j !== i) })}>
                    <Icon name="close" size={12} />
                  </button>
                </span>
              )}
            </div>
          ))}
          {canEdit && (
            <div className="df-chart-adds">
              <button type="button" disabled={busy} onClick={() => set(withRow(d))}>
                {words.addSize}
              </button>
              <button type="button" disabled={busy} onClick={() => set(withMeasurement(d, words.measurement))}>
                {words.addMeasurement}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  const next = withSystems(d)
                  if (!next) return onToast(words.systemsThere)
                  set(next)
                  onToast(words.systemsAdded)
                }}
              >
                {words.addSystems}
              </button>
              <span>{words.ranges}</span>
            </div>
          )}
        </div>
        {tried && problem && (
          <p className="df-coll-problem" role="alert">
            {words.problems[problem]}
          </p>
        )}
        <div className="df-coll-field">
          <label htmlFor={`${formId}-note`}>{words.fitNote}</label>
          <textarea id={`${formId}-note`} rows={2} value={d.fitNotes} readOnly={ro} maxLength={500} placeholder={words.fitPlaceholder} onChange={(e) => set({ ...d, fitNotes: e.target.value })} />
        </div>
        <p className="df-coll-hint">{fill(plural(words.used, products), { count: formatCount(products) })}</p>
        {canEdit && (
          <div className="df-chart-actions">
            <button type="button" className="df-button df-coll-delete" disabled={busy} onClick={remove}>
              {words.delete}
            </button>
            <button type="button" className="df-button" disabled={busy} onClick={copy}>
              {words.copy}
            </button>
            <button type="button" className="df-button df-button--primary" disabled={busy} onClick={save}>
              {busy ? words.saving : words.save}
            </button>
          </div>
        )}
        {preview && (
          <div className="df-chart-preview">
            <div>
              <strong>{fill(words.previewTitle, { name: d.name })}</strong>
              <span>{fill(words.previewSwitch, { unit: d.unit, other: d.unit === 'cm' ? 'in' : 'cm' })}</span>
            </div>
            <table>
              <thead>
                <tr>
                  <th scope="col">{words.sizeHead}</th>
                  {columns.map((h, i) => (
                    <th scope="col" key={i}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.rows.map((r, i) => (
                  <tr key={i}>
                    <th scope="row">{r.size || noValue}</th>
                    {r.values.map((v, j) => (
                      <td key={j}>{v || noValue}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {d.fitNotes && <p>{d.fitNotes}</p>}
          </div>
        )}
      </section>
      {starting && <TemplatePicker unit={unit} india={india} onPick={fromTemplate} onCancel={() => setStarting(false)} />}
      {ask && <ConfirmDialog key={`${ask.title}|${ask.target}`} cancelLabel={words.cancel} {...ask} open onCancel={() => setAsk(null)} onConfirm={(...args) => { setAsk(null); ask.onConfirm(...args) }} />}
    </div>
  )
}
