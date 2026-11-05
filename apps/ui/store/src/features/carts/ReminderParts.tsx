import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import '../common/switch.css'

// The pieces the Carts and Wishlists Reminders panes draw the same way, so a fix to one reaches both.

interface Rule {
  title: string
  body: string
}

export interface RuleWords {
  skipOutOfStock: Rule
  quietHours: Rule
  weeklyCap: Rule
  stop: Rule
}

const Switch = ({ on, label, disabled, onToggle }: { on: boolean; label: string; disabled: boolean; onToggle: () => void }) => (
  <button type="button" role="switch" className="df-switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={onToggle}>
    <span aria-hidden="true" />
  </button>
)

/** The "send automatically" card: its state in words, and the switch, or the way to a plan that has it. */
export const AutoCard = ({ title, summary, level, on, readOnly, canUpgrade, seePlans, askOwner, onToggle }: { title: string; summary: string; level: string; on: boolean; readOnly: boolean; canUpgrade: boolean; seePlans: string; askOwner: string; onToggle: () => void }) => (
  <section className="df-cart-card df-reminders-auto">
    <span className="df-carts-cell">
      <strong>{title}</strong>
      <span className="df-carts-sub">{summary}</span>
    </span>
    {level === 'youSend' ? (
      canUpgrade ? (
        <Link className="df-button" to="/billing">
          {seePlans}
        </Link>
      ) : (
        <span className="df-carts-sub">{askOwner}</span>
      )
    ) : (
      <Switch on={on} label={title} disabled={readOnly} onToggle={onToggle} />
    )}
  </section>
)

/** A step's number, name, summary, Preview button and (past the first, on a plan that has it) its switch. */
export const StepHead = ({ idPrefix, n, name, summary, shown, previewLabel, previewText, switchLabel, showSwitch, on, readOnly, onPreview, onToggle }: { idPrefix: string; n: string; name: string; summary: string; shown: boolean; previewLabel: string; previewText: string; switchLabel: string; showSwitch: boolean; on: boolean; readOnly: boolean; onPreview: () => void; onToggle: () => void }) => (
  <div className="df-reminders-step-head">
    <span className="df-reminders-n" aria-hidden="true">
      {n}
    </span>
    <span className="df-carts-cell">
      <strong id={`${idPrefix}-${n}`}>{name}</strong>
      <span className="df-carts-sub">{summary}</span>
    </span>
    <button type="button" className="df-button" aria-pressed={shown} aria-label={previewLabel} onClick={onPreview}>
      {previewText}
    </button>
    {showSwitch && <Switch on={on} label={switchLabel} disabled={readOnly} onToggle={onToggle} />}
  </div>
)

/** The rule checkboxes: the three a store can change, and the stop rule that is always on. */
export const RuleChecks = ({ rules, form, readOnly, onToggle }: { rules: RuleWords; form: Record<'skipOutOfStock' | 'quietHours' | 'weeklyCap', boolean>; readOnly: boolean; onToggle: (key: 'skipOutOfStock' | 'quietHours' | 'weeklyCap') => void }) => (
  <>
    {(['skipOutOfStock', 'quietHours', 'weeklyCap'] as const).map((key) => (
      <label key={key} className="df-reminders-rule">
        <input type="checkbox" checked={form[key]} disabled={readOnly} onChange={() => onToggle(key)} />
        <span className="df-carts-cell">
          <strong>{rules[key].title}</strong>
          <span className="df-carts-sub">{rules[key].body}</span>
        </span>
      </label>
    ))}
    <label className="df-reminders-rule">
      <input type="checkbox" checked disabled />
      <span className="df-carts-cell">
        <strong>{rules.stop.title}</strong>
        <span className="df-carts-sub">{rules.stop.body}</span>
      </span>
    </label>
  </>
)

/** The stale-revision, refusal, saved and extra notes under the form. */
export const FormNotes = ({ stale, staleText, reloadText, problem, saved, extra, onReload }: { stale: boolean; staleText: string; reloadText: string; problem: string | null; saved: string | null; extra?: string | null; onReload: () => void }): ReactNode => (
  <>
    {stale && (
      <p className="df-carts-note df-carts-note--warning df-reminders-span" role="alert">
        <strong>{staleText}</strong>{' '}
        <button type="button" className="df-button" onClick={onReload}>
          {reloadText}
        </button>
      </p>
    )}
    {problem && (
      <p className="df-carts-note df-carts-note--danger df-reminders-span" role="alert">
        {problem}
      </p>
    )}
    {saved && (
      <p className="df-carts-note df-reminders-span" role="status">
        {saved}
      </p>
    )}
    {extra && (
      <p className="df-carts-note df-reminders-span" role="status">
        {extra}
      </p>
    )}
  </>
)

/** The bar that appears when the form has unsaved changes. */
export const SaveBar = ({ unsaved, discard, save, saving, busy, onDiscard, onSave }: { unsaved: string; discard: string; save: string; saving: string; busy: boolean; onDiscard: () => void; onSave: () => void }) => (
  <div className="df-reminders-bar">
    <span>
      <strong>{unsaved}</strong>
    </span>
    <span className="df-reminders-bar-actions">
      <button type="button" className="df-button" disabled={busy} onClick={onDiscard}>
        {discard}
      </button>
      <button type="button" className="df-button df-button--primary" disabled={busy} onClick={onSave}>
        {busy ? saving : save}
      </button>
    </span>
  </div>
)
