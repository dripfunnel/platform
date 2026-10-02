import { entitlementRows, type NumberKey, type PlanCeilings, type ToggleKey } from '../../api/plans'
import { fill, formatCount, messages } from '../../messages'
import { numberOf, rowsMissing, type PlanDraft } from './planDraft'

const words = messages.plans.editor

export interface EntitlementMatrixProps {
  draft: PlanDraft
  ceilings: PlanCeilings
  disabled: boolean
  onToggle: (key: ToggleKey, on: boolean) => void
  onNumber: (key: NumberKey, text: string) => void
}

// What's included (§7.2; SAAS.md §6.1): on/off, limit and monthly-allowance rows, each with DripFunnel's ceiling.
// A value above it is marked and refused by the API; nothing is clamped here.
export const EntitlementMatrix = ({ draft, ceilings, disabled, onToggle, onNumber }: EntitlementMatrixProps) => (
  <section className="df-panel df-editor-card" aria-labelledby="plan-included">
    <h2 id="plan-included">{words.included}</h2>
    <ul className="df-matrix">
      {entitlementRows.map((row) => {
        if (row.kind === 'toggle') {
          const key = row.key as ToggleKey
          const powered = key === 'powered'
          const over = powered && draft.toggles.powered && !ceilings.powered.allowed
          return (
            <li key={key}>
              <strong>{words.rows[key]}</strong>
              <span className="df-matrix-kind">{words.kinds.toggle}</span>
              <div className="df-stack">
                <label className="df-matrix-toggle">
                  <input type="checkbox" checked={draft.toggles[key]} disabled={disabled} aria-invalid={over} aria-describedby={over ? 'ceiling-powered' : undefined} onChange={(event) => onToggle(key, event.target.checked)} />
                  {words.includedLabel}
                </label>
                {over && (
                  <span id="ceiling-powered" className="df-margin df-margin--loss">
                    {words.poweredRefused}
                  </span>
                )}
              </div>
              <span className="df-muted">{powered ? (ceilings.powered.note === 'firstYear' ? words.poweredFirstYear : words.poweredAllowed) : words.available}</span>
            </li>
          )
        }
        const key = row.key as NumberKey
        const max = ceilings[key]
        const over = numberOf(draft.numbers[key]) > max
        const missing = rowsMissing(draft).includes(key)
        return (
          <li key={key}>
            <strong>{words.rows[key]}</strong>
            <span className="df-matrix-kind">{words.kinds[row.kind]}</span>
            <div className="df-stack">
              <input
                className="df-matrix-input"
                inputMode="numeric"
                value={draft.numbers[key]}
                disabled={disabled}
                aria-label={words.rows[key]}
                aria-invalid={over || missing}
                aria-describedby={over || missing ? `ceiling-${key}` : undefined}
                onChange={(event) => onNumber(key, event.target.value.replace(/\D/g, ''))}
              />
              {(over || missing) && (
                <span id={`ceiling-${key}`} className="df-margin df-margin--loss">
                  {over ? fill(words.overCeiling, { max: formatCount(max) }) : words.missing}
                </span>
              )}
            </div>
            <span className="df-muted">{fill(row.kind === 'allowance' ? words.ceilingMonthly : words.ceiling, { max: formatCount(max) })}</span>
          </li>
        )
      })}
    </ul>
  </section>
)
