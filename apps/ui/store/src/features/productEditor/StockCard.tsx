import { useId, useState } from 'react'
import type { StockLevel, StockMovement, Warehouse } from '../../api/stock'
import { fill, formatCount, formatTime, messages, plural } from '../../messages'
import { quantityOf, versionKey, type Draft, type DraftProblem } from './draft'
import { Card, type Update } from './EditorCards'

const words = messages.editor.stock

export interface StockHistoryView {
  open: boolean
  rows: StockMovement[] | null
  more: boolean
  failed: boolean
}

/** A movement as shoppers' stock moved: +20, −2. */
export const signed = (n: number) => (n > 0 ? fill(words.deltaUp, { count: formatCount(n) }) : n < 0 ? fill(words.deltaDown, { count: formatCount(-n) }) : formatCount(0))

/** The latest movements: what changed, why, who and where, and the quantity it left (G5). */
export const StockHistory = ({ history, onToggle, names }: { history: StockHistoryView; onToggle: () => void; names: ReadonlyMap<string, string> }) => (
  <>
    <button type="button" className="df-editor-link" aria-expanded={history.open} onClick={onToggle}>
      {history.open ? words.hideHistory : words.history}
    </button>
    {history.open && (
      <div className="df-editor-history">
        {history.failed ? (
          <p className="df-editor-problem">{messages.editor.error.title}</p>
        ) : history.rows === null ? (
          <p className="df-editor-hint">{messages.editor.loading}</p>
        ) : history.rows.length === 0 ? (
          <p className="df-editor-hint">{words.historyNone}</p>
        ) : (
          <ul>
            {history.rows.map((m) => (
              <li key={m.id}>
                <span className={m.delta > 0 ? 'df-editor-delta df-editor-delta--up' : m.delta < 0 ? 'df-editor-delta df-editor-delta--down' : 'df-editor-delta'}>{signed(m.delta)}</span>
                <span>
                  <strong>{(words.reasons as Record<string, string>)[m.reason] ?? m.reason}</strong>
                  <span>{[names.get(m.versionId), m.warehouseName, m.actorKind === 'system' ? words.bySystem : m.actorName ? fill(words.by, { name: m.actorName }) : null, fill(words.now, { count: formatCount(m.resultingQuantity) })].filter(Boolean).join(' · ')}</span>
                </span>
                <time dateTime={m.occurredAt}>{formatTime(m.occurredAt)}</time>
              </li>
            ))}
          </ul>
        )}
        {history.more && <p className="df-editor-hint">{words.historyMore}</p>}
        <p className="df-editor-hint">{words.historyNote}</p>
      </div>
    )}
  </>
)

/** Reserved across a version's locations, and what is left to sell. */
export const reservedLine = (levels: readonly StockLevel[], onHand: number): string | null => {
  const reserved = levels.reduce((sum, l) => sum + l.reserved, 0)
  return reserved > 0 ? fill(plural(words.reserved, reserved), { count: formatCount(reserved), free: formatCount(Math.max(0, onHand - reserved)) }) : null
}

/** A product without choices: its count at the default location, or split across locations; reasoned changes and history. */
export const StockCard = ({
  draft,
  update,
  canStock,
  warehouses,
  levels,
  versionId,
  problems,
  history,
  onHistory,
  onAdjust,
  names,
}: {
  draft: Draft
  update: Update
  canStock: boolean
  warehouses: readonly Warehouse[]
  levels: readonly StockLevel[]
  versionId: string | null
  problems: readonly DraftProblem[]
  history: StockHistoryView
  onHistory: () => void
  onAdjust: (versionId: string, warehouses: readonly Warehouse[]) => void
  names: ReadonlyMap<string, string>
}) => {
  const id = useId()
  const key = versionKey(draft.versions[0]?.choices ?? [])
  const typed = draft.stock[key] ?? {}
  const counted = warehouses.filter((w) => typed[w.id] !== undefined && typed[w.id] !== '')
  const [split, setSplit] = useState(counted.length > 1)
  const home = warehouses.find((w) => w.isDefault) ?? warehouses[0]
  if (!home) return <Card title={words.title}>{<p className="df-editor-hint">{words.noWarehouse}</p>}</Card>
  const set = (warehouseId: string, text: string) => update((d) => ({ ...d, stock: { ...d.stock, [key]: { ...d.stock[key], [warehouseId]: text } } }))
  const step = (by: number) => set(home.id, String(Math.max(0, (Number(typed[home.id]) || 0) + by)))
  const total = Object.values(typed).reduce((sum, t) => sum + (Number(t) || 0), 0)
  const reserved = reservedLine(levels, total)
  const bad = problems.includes('stock')
  const shown = split ? warehouses : [home]
  return (
    <Card title={words.title} aside={<span className="df-editor-meter">{split ? fill(words.whereSplit, { count: String(warehouses.length) }) : fill(words.where, { warehouse: home.name })}</span>}>
      {shown.map((w) => {
        const invalid = bad && quantityOf(typed[w.id] ?? '') === 'invalid'
        return (
          <div key={w.id} className="df-editor-stock-row">
            <label htmlFor={`${id}-${w.id}`}>{fill(words.label, { warehouse: w.name })}</label>
            <span className="df-editor-stepper">
              {!split && canStock && (
                <button type="button" aria-label={words.less} onClick={() => step(-1)}>
                  −
                </button>
              )}
              <input id={`${id}-${w.id}`} inputMode="numeric" value={typed[w.id] ?? ''} placeholder={words.countPlaceholder} readOnly={!canStock} aria-invalid={invalid} onChange={(event) => set(w.id, event.target.value)} />
              {!split && canStock && (
                <button type="button" aria-label={words.more} onClick={() => step(1)}>
                  +
                </button>
              )}
            </span>
            {invalid && <span className="df-editor-problem">{words.invalid}</span>}
          </div>
        )
      })}
      {split && <p className="df-editor-meter">{fill(words.total, { count: formatCount(total) })}</p>}
      {!split && <p className="df-editor-hint">{words.help}</p>}
      {reserved && <p className="df-editor-note">{reserved}</p>}
      <div className="df-editor-stock-actions">
        {canStock && warehouses.length > 1 && (
          <button type="button" className="df-editor-link" onClick={() => setSplit((s) => !s)}>
            {split ? words.unsplit : words.split}
          </button>
        )}
        {canStock && versionId && (
          <button type="button" className="df-editor-link" onClick={() => onAdjust(versionId, warehouses)}>
            {words.adjust}
          </button>
        )}
        {versionId && <StockHistory history={history} onToggle={onHistory} names={names} />}
      </div>
    </Card>
  )
}
