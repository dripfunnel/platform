import { planGroups, planKeyDefs, UNLIMITED, type PlanKeyDef } from '../../api/planKeys'
import type { PlanCeilings } from '../../api/plans'
import { fill, formatCount, messages } from '../../messages'
import { numberOf, rowsMissing, type PlanDraft } from './planDraft'

const words = messages.plans.editor
const labelOf = (key: string): string => (words.rows as Record<string, string>)[key] ?? key
const choiceWords = words.choices as Record<string, string>

export interface EntitlementMatrixProps {
  draft: PlanDraft
  ceilings: PlanCeilings
  disabled: boolean
  onToggle: (key: string, on: boolean) => void
  onNumber: (key: string, text: string) => void
}

const Planned = () => <span className="df-matrix-planned">{words.planned}</span>

// What's included (§7.2; SAAS.md §6.1), grouped as the pricing page compares plans. A row whose feature
// isn't built yet is saved and tagged Planned; a value above DripFunnel's ceiling is marked and refused
// by the API, nothing is clamped here.
export const EntitlementMatrix = ({ draft, ceilings, disabled, onToggle, onNumber }: EntitlementMatrixProps) => {
  const kindOf = (def: PlanKeyDef) => (def.kind === 'switch' ? words.kinds.toggle : def.kind === 'choice' ? words.kinds.choice : def.monthly ? words.kinds.allowance : words.kinds.limit)
  const row = (def: PlanKeyDef) => {
    const key = def.key
    const name = (
      <strong>
        {labelOf(key)} {!def.enforced && <Planned />}
      </strong>
    )
    if (def.kind === 'switch') {
      const powered = key === 'powered_by_removal'
      const over = powered && draft.toggles[key] === true && !ceilings.powered.allowed
      return (
        <li key={key}>
          {name}
          <span className="df-matrix-kind">{kindOf(def)}</span>
          <div className="df-stack">
            <label className="df-matrix-toggle">
              <input type="checkbox" checked={draft.toggles[key] === true} disabled={disabled} aria-invalid={over} aria-describedby={over ? 'ceiling-powered' : undefined} onChange={(event) => onToggle(key, event.target.checked)} />
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
    const text = draft.numbers[key] ?? ''
    if (def.kind === 'choice') {
      return (
        <li key={key}>
          {name}
          <span className="df-matrix-kind">{kindOf(def)}</span>
          <div className="df-stack">
            <select value={text} disabled={disabled} aria-label={labelOf(key)} onChange={(event) => onNumber(key, event.target.value)}>
              {def.choices.map((choice, index) => (
                <option key={choice} value={String(index)}>
                  {choiceWords[choice] ?? choice}
                </option>
              ))}
            </select>
          </div>
          <span className="df-muted">{words.available}</span>
        </li>
      )
    }
    const max = ceilings.amounts[key] ?? null
    const unlimited = numberOf(text) === UNLIMITED
    const over = max !== null && numberOf(text) > max
    const missing = rowsMissing(draft).includes(key)
    return (
      <li key={key}>
        {name}
        <span className="df-matrix-kind">{kindOf(def)}</span>
        <div className="df-stack">
          <input
            className="df-matrix-input"
            inputMode="numeric"
            value={unlimited ? '' : text}
            placeholder={unlimited ? words.unlimited : undefined}
            disabled={disabled || unlimited}
            aria-label={labelOf(key)}
            aria-invalid={over || missing}
            aria-describedby={over || missing ? `ceiling-${key}` : undefined}
            onChange={(event) => onNumber(key, event.target.value.replace(/\D/g, ''))}
          />
          <label className="df-matrix-toggle">
            <input type="checkbox" checked={unlimited} disabled={disabled || (max !== null && max < UNLIMITED)} onChange={(event) => onNumber(key, event.target.checked ? String(UNLIMITED) : '')} />
            {words.unlimited}
          </label>
          {(over || missing) && (
            <span id={`ceiling-${key}`} className="df-margin df-margin--loss">
              {over && max !== null ? fill(words.overCeiling, { max: formatCount(max) }) : words.missing}
            </span>
          )}
        </div>
        <span className="df-muted">{max === null ? words.noCeiling : fill(def.monthly ? words.ceilingMonthly : words.ceiling, { max: formatCount(max) })}</span>
      </li>
    )
  }
  return (
    <section className="df-panel df-editor-card" aria-labelledby="plan-included">
      <h2 id="plan-included">{words.included}</h2>
      {planGroups.map((group) => (
        <div key={group} role="group" aria-labelledby={`plan-group-${group}`}>
          <h3 id={`plan-group-${group}`} className="df-matrix-group">
            {(words.groups as Record<string, string>)[group] ?? group}
          </h3>
          <ul className="df-matrix">{planKeyDefs.filter((def) => def.group === group).map(row)}</ul>
        </div>
      ))}
    </section>
  )
}
