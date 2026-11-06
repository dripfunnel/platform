import { getRouteApi, useRouter, useRouterState } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import { actionsFor, fleetManagers, steerRollout, type RolloutAction } from '../../api/rollouts'
import { fill, messages } from '../../messages'
import { ConfirmDialog, Toast, useScreenState } from '@dripfunnel/shared/ui'
import { harnessEnabled } from '../../harness'
import { refusalWords, rolloutDialog } from './rolloutDialog'
import { RolloutDetail, RolloutDetailError } from './RolloutDetail'
import { rolloutsStates } from './rolloutsHarness'

const detailRoute = getRouteApi('/_app/rollouts_/$rolloutId')
const appRoute = getRouteApi('/_app')
const words = messages.rollouts

export const RolloutDetailScreen = () => {
  const page = detailRoute.useLoaderData()
  const { status } = detailRoute.useSearch()
  const { me } = appRoute.useLoaderData()
  const forced = useScreenState(rolloutsStates, harnessEnabled)
  const navigate = detailRoute.useNavigate()
  const router = useRouter()
  const rollout = page && page !== 'denied' ? page.rollout : null
  const [pending, setPending] = useState<RolloutAction | null>(() => (forced === 'confirm' && rollout ? (actionsFor(rollout.state)[0] ?? null) : null))
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const clearToast = useCallback(() => setToast(null), [])
  const arrived = useRouterState({ select: (state) => state.location.state.toast })
  // Start's confirmation, shown once: taken out of the history entry so Back or a reload doesn't repeat it.
  useEffect(() => {
    if (!arrived) return
    setToast(arrived)
    void navigate({ search: (search) => search, state: {}, replace: true })
  }, [arrived, navigate])

  const close = () => {
    setPending(null)
    setError(null)
  }

  const onConfirm = (reason: string | null) => {
    if (!rollout || !pending) return
    const action = pending
    setError(null)
    steerRollout(action, rollout.id, reason ?? '')
      .then(() => {
        close()
        setToast(fill(words.done[action], { version: rollout.version }))
        return router.invalidate()
      })
      .catch((failure: unknown) => setError(refusalWords(failure)))
  }

  const dialog = rollout && pending ? rolloutDialog({ kind: 'steer', action: pending, rollout }) : null

  return (
    <>
      <RolloutDetail
        page={page}
        status={status}
        forced={forced}
        canManage={fleetManagers.includes(me.role)}
        onStatus={(next) => void navigate({ search: { status: next }, replace: true })}
        onAction={setPending}
        onReload={() => void router.invalidate()}
      />
      <ConfirmDialog
        open={dialog !== null}
        title={dialog?.title ?? ''}
        target={dialog?.target ?? ''}
        consequence={dialog?.consequence ?? ''}
        confirmLabel={dialog?.confirmLabel ?? ''}
        cancelLabel={words.dialogs.cancel}
        {...(dialog?.reason ? { reason: dialog.reason } : {})}
        danger={dialog?.danger ?? false}
        error={error}
        onConfirm={(reason) => onConfirm(reason)}
        onCancel={close}
      />
      <Toast message={toast} onDone={clearToast} />
    </>
  )
}

export const RolloutDetailRouteError = () => {
  const router = useRouter()
  return <RolloutDetailError onRetry={() => void router.invalidate()} />
}
