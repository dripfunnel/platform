// States (?state=): loading, error, readonly, denied, confirm. Without one the editor shows the API's plan
// with DripFunnel's ceilings, and what this caller may change.
import { ActionControl, EmptyState, ErrorState, ListHeader, LoadingState, ReadOnlyNotice } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/list.css'
import '@dripfunnel/shared/ui/detail.css'
import { Link } from '@tanstack/react-router'
import type { Me } from '../../api/me'
import type { NumberKey, PlanEditor as PlanEditorData, PlanPrice, ToggleKey } from '../../api/plans'
import { fill, formatCount, messages, plural } from '../../messages'
import { EntitlementMatrix } from './EntitlementMatrix'
import { hasInvalidPrice, isDirty, rowsAboveCeiling, rowsMissing, type PlanDraft } from './planDraft'
import { PlanStatusPill } from './planLook'
import type { PlanEditorState } from './plansHarness'
import { PriceRows } from './PriceRows'
import './plans.css'

const words = messages.plans.editor

export interface PlanEditorProps {
  me: Me
  editor: PlanEditorData | null
  draft: PlanDraft
  original: PlanDraft
  quoted: readonly PlanPrice[]
  forced: PlanEditorState | null
  busy: boolean
  onDraft: (draft: PlanDraft) => void
  onSave: () => void
  onDiscard: () => void
  onMakeLive: () => void
  onRetire: () => void
  onReload: () => void
}

export const PlanEditorLoading = () => (
  <div className="df-page df-list">
    <LoadingState label={words.loading} rows={6} />
  </div>
)

export const PlanEditorError = ({ onRetry }: { onRetry: () => void }) => (
  <div className="df-page df-list">
    <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry }} />
  </div>
)

const saveRefusal = (draft: PlanDraft, editor: PlanEditorData, canEdit: boolean, canPrice: boolean): string | null => {
  if (!canEdit && !canPrice) return messages.plans.refused.OWNERS_AND_ADMINS_ONLY
  if (rowsAboveCeiling(draft, editor.ceilings).length > 0 || rowsMissing(draft).length > 0 || hasInvalidPrice(draft)) return words.fixRows
  if (draft.name.trim() === '') return words.nameRequired
  return null
}

export const PlanEditor = ({ me, editor, draft, original, quoted, forced, busy, onDraft, onSave, onDiscard, onMakeLive, onRetire, onReload }: PlanEditorProps) => {
  if (forced === 'loading') return <PlanEditorLoading />
  if (forced === 'error') return <PlanEditorError onRetry={onReload} />
  if (!editor) {
    return (
      <div className="df-page df-list">
        <EmptyState
          title={words.notFound.title}
          body={words.notFound.body}
          action={
            <Link to="/plans" className="df-button">
              {words.notFound.back}
            </Link>
          }
        />
      </div>
    )
  }
  const { plan } = editor
  const canEdit = editor.permission.edit.allowed
  const canPrice = editor.permission.price.allowed
  const dirty = isDirty(draft, original)
  const over = rowsAboveCeiling(draft, editor.ceilings)
  const loss = quoted.some((price) => price.margin.kind === 'loss')
  const missing = rowsMissing(draft)
  const problem =
    over.length > 0
      ? fill(plural(words.errors.above, over.length), { rows: over.map((key) => words.rows[key]).join(', ') })
      : missing.length > 0
        ? fill(words.errors.missing, { rows: missing.map((key) => words.rows[key]).join(', ') })
        : hasInvalidPrice(draft)
          ? words.errors.invalid
          : loss
            ? words.errors.loss
            : null
  const title = plan ? draft.name.trim() || words.untitled : words.newTitle
  const sub = plan ? (plan.stores > 0 ? fill(plural(words.storesOn, plan.stores), { count: formatCount(plan.stores) }) : words.noStores) : words.draftNote
  const set = (patch: Partial<PlanDraft>) => onDraft({ ...draft, ...patch })
  return (
    <div className="df-page df-list df-plan-editor">
      <nav aria-label={messages.store.breadcrumbLabel} className="df-breadcrumb">
        <Link to="/plans">{messages.screens.plans.title}</Link>
        <span aria-hidden="true">›</span>
        <span aria-current="page">{title}</span>
      </nav>
      <ListHeader title={title} sub={sub} />
      {(me.role === 'partner-read-only' || forced === 'readonly') && <ReadOnlyNotice title={messages.states.readonly.title} body={messages.states.readonly.body} />}
      {!canEdit && <p className="df-editor-note">{canPrice ? words.financeNote : words.viewNote}</p>}
      {problem && (
        <p role="alert" className="df-editor-problem">
          {problem}
        </p>
      )}
      <div className="df-editor">
        <div className="df-editor-main">
          <section className="df-panel df-editor-card df-editor-basics" aria-label={words.name}>
            <div className="df-field">
              <label htmlFor="plan-name">{words.name}</label>
              <input id="plan-name" type="text" value={draft.name} maxLength={60} disabled={!canEdit} onChange={(event) => set({ name: event.target.value })} />
            </div>
            <div className="df-field">
              <label htmlFor="plan-trial">{words.trial}</label>
              <select id="plan-trial" value={draft.trialDays} disabled={!canEdit} onChange={(event) => set({ trialDays: event.target.value })}>
                {editor.trials.map((days) => (
                  <option key={days} value={String(days)}>
                    {days === 0 ? words.trials.none : fill(words.trials.days, { count: formatCount(days) })}
                  </option>
                ))}
              </select>
            </div>
            <div className="df-field df-editor-wide">
              <label htmlFor="plan-description">{words.description}</label>
              <input id="plan-description" type="text" value={draft.description} maxLength={140} disabled={!canEdit} onChange={(event) => set({ description: event.target.value })} />
            </div>
          </section>
          <PriceRows draft={draft} quoted={quoted} disabled={!canPrice} onChange={(currency, field, text) => set({ prices: { ...draft.prices, [currency]: { ...(draft.prices[currency] ?? { monthly: '', yearly: '' }), [field]: text } } })} />
          <EntitlementMatrix
            draft={draft}
            ceilings={editor.ceilings}
            disabled={!canEdit}
            onToggle={(key: ToggleKey, on) => set({ toggles: { ...draft.toggles, [key]: on } })}
            onNumber={(key: NumberKey, text) => set({ numbers: { ...draft.numbers, [key]: text } })}
          />
        </div>
        <aside className="df-editor-side">
          <section className="df-panel df-editor-card" aria-label={messages.plans.columns.status}>
            <div className="df-stack">
              <PlanStatusPill status={plan?.status ?? 'draft'} />
              <span className="df-muted">{sub}</span>
            </div>
            {plan?.status === 'draft' && <ActionControl label={words.makeLive} refusal={canEdit ? null : messages.plans.refused.OWNERS_AND_ADMINS_ONLY} disabled={busy || dirty} onRun={onMakeLive} />}
            {plan?.status === 'live' && <ActionControl label={words.retire} refusal={canEdit ? null : messages.plans.refused.OWNERS_AND_ADMINS_ONLY} disabled={busy || dirty} onRun={onRetire} />}
          </section>
        </aside>
      </div>
      {dirty && (
        <div className="df-save-bar" role="region" aria-label={words.unsaved}>
          <span>{words.unsaved}</span>
          <button type="button" className="df-button" onClick={onDiscard} disabled={busy}>
            {words.discard}
          </button>
          <ActionControl label={words.save} refusal={saveRefusal(draft, editor, canEdit, canPrice)} primary disabled={busy} onRun={onSave} />
        </div>
      )}
    </div>
  )
}
