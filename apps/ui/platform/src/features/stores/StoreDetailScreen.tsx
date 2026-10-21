import { ConfirmDialog, Toast, useCurrentStaffSession, useScreenState } from '@dripfunnel/shared/ui'
import { getRouteApi, useRouter } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import { loadChangePlanOptions, recheckStoreDomain, runStoreAction, storeActions, type ChangePlanOptions, type Store, type StoreAction } from '../../api/stores'
import { staffSession } from '../../api/staffSession'
import { fill, messages } from '../../messages'
import { harnessEnabled } from '../../harness'
import { actionInput, storeDialog, storeToast } from './storeDialog'
import { StoreDetail, StoreError } from './StoreDetail'
import { useStartSupport } from '../support/useStartSupport'
import { supportStartOffered } from '../support/supportText'
import { storeStates } from './storeHarness'

const storeRoute = getRouteApi('/_app/stores_/$storeId')
const shellRoute = getRouteApi('/_app')

// ?state=confirm opens the first action this store offers the caller, so its dialog can be checked.
const firstAllowed = (store: Store | null): StoreAction | null => storeActions.find((action) => store?.actions[action]?.allowed) ?? null

export const StoreDetailScreen = () => {
  const store = storeRoute.useLoaderData()
  const { tab = 'overview' } = storeRoute.useSearch()
  const { me } = shellRoute.useLoaderData()
  const forced = useScreenState(storeStates, harnessEnabled)
  const router = useRouter()
  const [pending, setPending] = useState<{ action: StoreAction; options: ChangePlanOptions | null } | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const clearToast = useCallback(() => setToast(null), [])
  const failed = () => setToast(messages.store.toasts.failed)
  const support = useStartSupport(me)
  // Support sessions are a partner user's own: a staff session can't start one (ACCESS.md §8.2).
  const staff = useCurrentStaffSession(staffSession)
  const onStartSupport = store && supportStartOffered(me.role, staff?.state === 'open') ? (person: { id: string; email: string }) => void support.openFor(person, store.id) : undefined

  // Change plan asks the API for the plans offered and the proration before the dialog opens.
  const open = (action: StoreAction) => {
    if (!store) return
    if (action !== 'changePlan') return setPending({ action, options: null })
    loadChangePlanOptions(store.id).then((options) => setPending({ action, options }), failed)
  }

  const onConfirm = (reason: string | null, value: string | null, picks: Readonly<Record<string, string>>) => {
    if (!store || !pending) return
    const input = actionInput(pending.action, reason, value, picks)
    const { options } = pending
    setPending(null)
    if (!input) return
    runStoreAction(store.id, input)
      .then((result) => {
        if (!result.ok) return setToast(fill(messages.store.toasts.refused, { reason: fill(messages.store.refused[result.reason], { verb: messages.store.verbs[input.action], name: store.name }) }))
        setToast(storeToast(input, store, options))
        return router.invalidate()
      })
      .catch(failed)
  }

  const onRecheck = () =>
    store
      ? recheckStoreDomain(store.id)
          .then(async () => {
            setToast(fill(messages.store.domains.recheckAsked, { host: store.domain?.host ?? store.code }))
            await router.invalidate()
          })
          .catch(failed)
      : Promise.resolve()

  // Once on arrival: the harness's confirm state opens the first dialog the caller may use.
  useEffect(() => {
    const first = forced === 'confirm' ? firstAllowed(store) : null
    if (first) open(first)
  }, [])

  const dialog = store && pending ? storeDialog(pending.action, store, pending.options) : null

  return (
    <>
      <StoreDetail me={me} store={store} tab={tab} forced={forced} onAction={open} onRecheck={onRecheck} onStartSupport={onStartSupport} onReload={() => void router.invalidate()} />
      {store && (
        <ConfirmDialog
          open={dialog !== null}
          title={dialog?.title ?? ''}
          target={dialog?.target ?? ''}
          consequence={dialog?.consequence ?? ''}
          confirmLabel={dialog?.confirmLabel ?? ''}
          cancelLabel={messages.store.cancel}
          {...(dialog?.notes ? { notes: dialog.notes } : {})}
          {...(dialog?.reason ? { reason: dialog.reason } : {})}
          {...(dialog?.typeToConfirm ? { typeToConfirm: dialog.typeToConfirm } : {})}
          {...(dialog?.input ? { input: dialog.input } : {})}
          {...(dialog?.choices ? { choices: dialog.choices } : {})}
          danger={dialog?.danger ?? false}
          onConfirm={onConfirm}
          onCancel={() => setPending(null)}
        />
      )}
      {support.element}
      <Toast message={toast} onDone={clearToast} />
    </>
  )
}

export const StoreRouteError = () => {
  const router = useRouter()
  return <StoreError onRetry={() => void router.invalidate()} />
}
