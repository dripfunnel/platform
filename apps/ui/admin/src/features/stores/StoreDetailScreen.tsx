import { getRouteApi, Link, useNavigate, useRouter, useRouterState } from '@tanstack/react-router'
import { useCallback, useMemo, useState } from 'react'
import { jobActions, type JobAction } from '../../api/provisioning'
import { recheckStoreDomain, runStoreAction, type Store, type StoreDnsRecord } from '../../api/stores'
import { fill, messages } from '../../messages'
import { actionCodes } from '../../api/activityActions'
import { ActivityTab } from '../common/ActivityTab'
import { ConfirmDialog, useScreenState, Toast } from '@dripfunnel/shared/ui'
import { harnessEnabled } from '../../harness'
import { callerFor } from '../common/harnessCaller'
import { useImpersonateFrom } from '../impersonate/useImpersonateFrom'
import { jobDialog, type JobTarget } from '../provisioning/jobDialog'
import { useJobRuns, type JobOutcome } from '../provisioning/useJobRuns'
import { storeDialog, storeToast, type DialogAction } from './storeDialog'
import { StoreDetail, StoreError } from './StoreDetail'
import { storeStates } from './storeHarness'

const storeRoute = getRouteApi('/_app/stores_/$storeId')
const shellRoute = getRouteApi('/_app')

type Pending = { kind: 'store'; action: DialogAction } | { kind: 'job'; action: JobAction }

const dialogActions: readonly DialogAction[] = ['suspend', 'restore', 'extendTrial', 'resendInvite']

// ?state=confirm opens the first action this store offers, its signup job's first, so its
// dialog can be checked.
const firstAllowed = (store: Store | null): Pending | null => {
  const job = jobActions.find((action) => store?.job?.actions[action]?.allowed)
  if (job) return { kind: 'job', action: job }
  const action = dialogActions.find((candidate) => store?.actions[candidate]?.allowed)
  return action ? { kind: 'store', action } : null
}

const targetOf = (store: Store): JobTarget => ({ name: store.name, code: store.code, owner: store.owner, step: store.setup.step, attempts: store.setup.attempts })

export const StoreDetailScreen = () => {
  const store = storeRoute.useLoaderData()
  const { tab = 'overview', after, before, action, result, date, from, to, ...customerFilter } = storeRoute.useSearch()
  const activityFilter = { action, result, date, from, to }
  const { me } = shellRoute.useLoaderData()
  const searchStr = useRouterState({ select: (state) => state.location.searchStr })
  const forced = useScreenState(storeStates, harnessEnabled)
  const router = useRouter()
  const navigate = useNavigate()
  const [pending, setPending] = useState<Pending | null>(() => (forced === 'confirm' ? firstAllowed(store) : null))
  const [toast, setToast] = useState<string | null>(null)
  const clearToast = useCallback(() => setToast(null), [])
  const failed = () => setToast(messages.store.toasts.failed)
  const sessions = useImpersonateFrom(callerFor(me.role, searchStr), me.name)

  const jobs = useMemo(() => (store?.job ? [{ id: store.job.id, state: store.setup.state }] : []), [store])
  // A cleaned-up signup has no page left to show (decided on #20), so its message goes with it
  // to Stores once the Workflow has finished.
  const onOutcome = useCallback(
    (outcome: JobOutcome, message: string) => {
      if (outcome === 'undone') void navigate({ to: '/stores', state: { toast: message } })
      else setToast(message)
    },
    [navigate],
  )
  const { run } = useJobRuns(jobs, onOutcome)

  const onConfirm = (next: Pending, target: Store, reason: string | null, value: string | null) => {
    setPending(null)
    if (next.kind === 'job') {
      if (!target.job) return
      run(next.action, target.job.id, targetOf(target), reason).then(setToast).catch(failed)
      return
    }
    runStoreAction(target.id, next.action, reason, value)
      .then(() => {
        setToast(storeToast(next.action, target, value))
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

  const dialog = store && pending ? (pending.kind === 'job' ? jobDialog(pending.action, targetOf(store)) : storeDialog(pending.action, store)) : null

  return (
    <>
      <StoreDetail
        store={store}
        tab={tab}
        forced={forced}
        readOnly={me.role === 'staff-read-only' || forced === 'readonly'}
        onAction={(action) => setPending({ kind: 'store', action })}
        onJob={(action) => setPending({ kind: 'job', action })}
        onAddNote={onAddNote}
        onRecheck={onRecheck}
        onImpersonate={sessions.impersonate}
        customers={{
          filter: customerFilter,
          page: { after, before },
          onFilterChange: (filter) => void navigate({ to: '.', search: { tab, ...filter }, replace: true }),
        }}
        onReload={() => void router.invalidate()}
        activity={
          store && (
            <ActivityTab
              scope={{ store: store.id }}
              filter={activityFilter}
              page={{ after, before }}
              caller={callerFor(me.role, searchStr)}
              actions={actionCodes}
              onFilterChange={(filter) => void navigate({ to: '.', search: { tab: 'activity', ...filter }, replace: true })}
              pageLink={(cursor, label) => (
                <Link to="/stores/$storeId" params={{ storeId: store.id }} search={{ tab: 'activity', ...activityFilter, ...cursor }} className="df-button">
                  {label}
                </Link>
              )}
            />
          )
        }
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
