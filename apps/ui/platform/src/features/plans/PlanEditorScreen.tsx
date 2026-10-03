import { ConfirmDialog, Toast, useScreenState } from '@dripfunnel/shared/ui'
import { getRouteApi, useRouter } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import { makePlanLive, quotePlanPrices, retirePlan, savePlan, type ApplyTo, type PlanPrice } from '../../api/plans'
import { harnessEnabled } from '../../harness'
import { fill, messages } from '../../messages'
import { planEditorStates } from './plansHarness'
import { draftOf, inputOf, type PlanDraft } from './planDraft'
import { retireDialog, retireInput, saveDialog, type PlanDialog } from './planDialogs'
import { PlanEditor, PlanEditorError } from './PlanEditor'

const planRoute = getRouteApi('/_app/plans_/$planId')
const shellRoute = getRouteApi('/_app')

// Waits for a pause in typing before asking the API to quote the fee and margin again.
const quoteDelayMs = 300

type Pending = { kind: 'save' } | { kind: 'retire' }

export const PlanEditorScreen = () => {
  const editor = planRoute.useLoaderData()
  const { planId } = planRoute.useParams()
  const { me } = shellRoute.useLoaderData()
  const forced = useScreenState(planEditorStates, harnessEnabled)
  const router = useRouter()
  const navigate = planRoute.useNavigate()
  const original = draftOf(editor?.plan ?? null, editor?.currencies ?? [], editor?.trials[2] ?? 14)
  const [draft, setDraft] = useState<PlanDraft>(original)
  const [quoted, setQuoted] = useState<readonly PlanPrice[]>(editor?.plan?.prices ?? [])
  const [pending, setPending] = useState<Pending | null>(forced === 'confirm' && editor?.plan && editor.permission.edit.allowed ? { kind: 'save' } : null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const clearToast = useCallback(() => setToast(null), [])
  const failed = () => setToast(messages.plans.toasts.failed)
  const refused = (reason: string) => setToast(fill(messages.plans.toasts.refused, { reason }))

  // A changed saved plan (after a save) resets the draft to it; a reload of the same plan keeps the typing.
  const originalKey = JSON.stringify(original)
  useEffect(() => {
    setDraft(JSON.parse(originalKey) as PlanDraft)
    setQuoted(JSON.parse(JSON.stringify(editor?.plan?.prices ?? [])) as PlanPrice[])
  }, [originalKey])

  // The fee and margin are the API's: re-quoted as prices are typed, never worked out here.
  const pricesKey = JSON.stringify(draft.prices)
  useEffect(() => {
    const input = inputOf(draft)
    if (!input) return
    const timer = setTimeout(() => {
      quotePlanPrices(editor?.plan?.id ?? null, input.prices).then(setQuoted, () => undefined)
    }, quoteDelayMs)
    return () => clearTimeout(timer)
  }, [pricesKey])

  if (!editor) return <PlanEditor me={me} editor={null} draft={draft} original={original} quoted={[]} forced={forced} busy={false} onDraft={setDraft} onSave={() => undefined} onDiscard={() => undefined} onMakeLive={() => undefined} onRetire={() => undefined} onReload={() => void router.invalidate()} />

  const name = draft.name.trim() || editor.plan?.name || messages.plans.editor.untitled
  const stores = editor.plan?.stores ?? 0

  const save = (applyTo: ApplyTo | null) => {
    const input = inputOf(draft)
    if (!input) return
    setBusy(true)
    savePlan(editor.plan?.id ?? null, input, applyTo)
      .then(async (result) => {
        setBusy(false)
        if (!result.ok) {
          const reason = result.reason === 'ABOVE_CEILING' ? fill(messages.plans.refused.ABOVE_CEILING, { row: messages.plans.editor.rows[result.row] }) : messages.plans.refused[result.reason]
          return refused(reason)
        }
        setToast(fill(applyTo === 'renewal' ? messages.plans.toasts.savedRenewal : applyTo === 'new' ? messages.plans.toasts.savedNew : messages.plans.toasts.saved, { plan: input.name }))
        if (planId === 'new') return navigate({ to: '/plans/$planId', params: { planId: result.id }, search: (prev) => prev })
        await router.invalidate()
      })
      .catch(() => {
        setBusy(false)
        failed()
      })
  }

  const makeLive = () => {
    if (!editor.plan) return
    setBusy(true)
    makePlanLive(editor.plan.id)
      .then(async (result) => {
        setBusy(false)
        if (!result.ok)
          return refused(
            result.reason !== 'UNPRICED_CURRENCY'
              ? messages.plans.refused[result.reason]
              : result.currency
                ? fill(messages.plans.refused.UNPRICED_CURRENCY, { currency: result.currency })
                : messages.plans.refused.UNPRICED,
          )
        setToast(fill(messages.plans.toasts.live, { plan: name }))
        await router.invalidate()
      })
      .catch(() => {
        setBusy(false)
        failed()
      })
  }

  const retire = (picks: Readonly<Record<string, string>>) => {
    const input = retireInput(picks)
    if (!editor.plan || !input) return
    setBusy(true)
    retirePlan(editor.plan.id, input)
      .then(async (result) => {
        setBusy(false)
        if (!result.ok) return refused(messages.plans.refused[result.reason])
        setToast(fill(messages.plans.toasts.retired, { plan: name }))
        await router.invalidate()
      })
      .catch(() => {
        setBusy(false)
        failed()
      })
  }

  const dialog: PlanDialog | null = pending ? (pending.kind === 'save' ? saveDialog(name, stores) : retireDialog(name, stores, editor)) : null

  return (
    <>
      <PlanEditor
        me={me}
        editor={editor}
        draft={draft}
        original={original}
        quoted={quoted}
        forced={forced}
        busy={busy}
        onDraft={setDraft}
        onSave={() => setPending({ kind: 'save' })}
        onDiscard={() => setDraft(original)}
        onMakeLive={makeLive}
        onRetire={() => setPending({ kind: 'retire' })}
        onReload={() => void router.invalidate()}
      />
      <ConfirmDialog
        open={dialog !== null}
        title={dialog?.title ?? ''}
        target={dialog?.target ?? ''}
        consequence={dialog?.consequence ?? ''}
        confirmLabel={dialog?.confirmLabel ?? ''}
        cancelLabel={messages.store.cancel}
        {...(dialog?.choices ? { choices: dialog.choices } : {})}
        danger={dialog?.danger ?? false}
        onConfirm={(_reason, _value, picks) => {
          const kind = pending?.kind
          setPending(null)
          if (kind === 'save') save(stores > 0 ? (picks.who === 'renewal' ? 'renewal' : 'new') : null)
          if (kind === 'retire') retire(picks)
        }}
        onCancel={() => setPending(null)}
      />
      <Toast message={toast} onDone={clearToast} />
    </>
  )
}

export const PlanEditorRouteError = () => {
  const router = useRouter()
  return <PlanEditorError onRetry={() => void router.invalidate()} />
}
