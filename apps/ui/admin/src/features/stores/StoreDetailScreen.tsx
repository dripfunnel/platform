import { getRouteApi, useNavigate, useRouter } from '@tanstack/react-router'
import { useCallback, useState } from 'react'
import { recheckStoreDomain, runStoreAction, type Store, type StoreDnsRecord } from '../../api/stores'
import { fill, messages } from '../../messages'
import { ConfirmDialog } from '../common/ConfirmDialog'
import { Toast } from '../common/Toast'
import { useScreenState } from '../common/useScreenState'
import { storeDialog, storeToast, type DialogAction } from './storeDialog'
import { StoreDetail, StoreError } from './StoreDetail'
import { storeStates } from './storeHarness'

const storeRoute = getRouteApi('/_app/stores_/$storeId')
const shellRoute = getRouteApi('/_app')

const dialogActions: readonly DialogAction[] = ['retry', 'suspend', 'restore', 'extendTrial', 'resendInvite', 'undo']

// ?state=confirm opens the first action this store offers, so its dialog can be checked.
const firstAllowed = (store: Store | null): DialogAction | null => dialogActions.find((action) => store?.actions[action]?.allowed) ?? null

export const StoreDetailScreen = () => {
  const store = storeRoute.useLoaderData()
  const { tab = 'overview', after, before, ...customerFilter } = storeRoute.useSearch()
  const { me } = shellRoute.useLoaderData()
  const forced = useScreenState(storeStates)
  const router = useRouter()
  const navigate = useNavigate()
  const [pending, setPending] = useState<DialogAction | null>(() => (forced === 'confirm' ? firstAllowed(store) : null))
  const [toast, setToast] = useState<string | null>(null)
  const clearToast = useCallback(() => setToast(null), [])
  const failed = () => setToast(messages.store.toasts.failed)

  const onConfirm = (action: DialogAction, target: Store, reason: string | null, value: string | null) => {
    setPending(null)
    runStoreAction(target.id, action, reason, value)
      .then(() => {
        const message = storeToast(action, target, value)
        // A cleaned-up signup has no page left to show (decided on #20), so its message goes
        // with it to Stores.
        if (action === 'undo') return navigate({ to: '/stores', state: { toast: message } })
        setToast(message)
        return router.invalidate()
      })
      .catch(failed)
  }

  // Resolves whether the note was saved, so a failed save keeps what was typed.
  const onAddNote = (text: string): Promise<boolean> =>
    store
      ? runStoreAction(store.id, 'addNote', null, text)
          .then(async () => {
            setToast(messages.store.toasts.addNote)
            await router.invalidate()
            return true
          })
          .catch(() => {
            failed()
            return false
          })
      : Promise.resolve(false)

  const onRecheck = (record: StoreDnsRecord) =>
    store
      ? recheckStoreDomain(store.id, record.host)
          .then((status) => setToast(fill(messages.store.domains.rechecked[status], { host: record.host })))
          .catch(failed)
      : Promise.resolve()

  const dialog = store && pending ? storeDialog(pending, store) : null

  return (
    <>
      <StoreDetail
        store={store}
        tab={tab}
        forced={forced}
        readOnly={me.role === 'staff-read-only' || forced === 'readonly'}
        onAction={setPending}
        onAddNote={onAddNote}
        onRecheck={onRecheck}
        customers={{
          filter: customerFilter,
          page: { after, before },
          onFilterChange: (filter) => void navigate({ to: '.', search: { tab, ...filter }, replace: true }),
        }}
        onReload={() => void router.invalidate()}
      />
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
          danger={dialog?.danger ?? false}
          onConfirm={(reason, value) => pending && onConfirm(pending, store, reason, value)}
          onCancel={() => setPending(null)}
        />
      )}
      <Toast message={toast} onDone={clearToast} />
    </>
  )
}

export const StoreRouteError = () => {
  const router = useRouter()
  return <StoreError onRetry={() => void router.invalidate()} />
}
