import { getRouteApi, Link, useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { activeRollout, fleetManagers, startRollout, type Rollout } from '../../api/rollouts'
import { fill, messages } from '../../messages'
import { ConfirmDialog, useScreenState } from '@dripfunnel/shared/ui'
import { isApiError } from '../../api/client'
import { harnessEnabled } from '../../harness'
import { refusalWords, rolloutDialog, securityChoice } from './rolloutDialog'
import { Rollouts, RolloutsError } from './Rollouts'
import { rolloutsStates } from './rolloutsHarness'

const rolloutsRoute = getRouteApi('/_app/rollouts')
const appRoute = getRouteApi('/_app')
const words = messages.rollouts

export const RolloutsScreen = () => {
  const page = rolloutsRoute.useLoaderData()
  const { me } = appRoute.useLoaderData()
  const forced = useScreenState(rolloutsStates, harnessEnabled)
  const router = useRouter()
  const navigate = rolloutsRoute.useNavigate()
  const [open, setOpen] = useState(forced === 'confirm')
  const [error, setError] = useState<string | null>(null)
  const [blocking, setBlocking] = useState<Rollout | null>(null)
  const dialog = rolloutDialog({ kind: 'start' })

  const close = () => {
    setOpen(false)
    setError(null)
    setBlocking(null)
  }

  const onConfirm = (reason: string | null, value: string | null, choices: Readonly<Record<string, string>>) => {
    const version = (value ?? '').trim()
    setError(null)
    startRollout({ version, security: choices[securityChoice] === 'security', reason: reason ?? '' })
      .then((id) => {
        close()
        void navigate({ to: '/rollouts/$rolloutId', params: { rolloutId: id }, state: { toast: fill(words.done.start, { version }) } })
      })
      .catch((failure: unknown) => {
        const inTheWay = isApiError(failure, 'ROLLOUT_ACTIVE') ? activeRollout(page) : null
        setBlocking(inTheWay)
        setError(refusalWords(failure, inTheWay))
      })
  }

  return (
    <>
      <Rollouts page={page} forced={forced} canManage={fleetManagers.includes(me.role)} onStart={() => setOpen(true)} onReload={() => void router.invalidate()} />
      <ConfirmDialog
        open={open}
        title={dialog.title}
        target={dialog.target}
        consequence={dialog.consequence}
        confirmLabel={dialog.confirmLabel}
        cancelLabel={words.dialogs.cancel}
        {...(dialog.reason ? { reason: dialog.reason } : {})}
        {...(dialog.input ? { input: dialog.input } : {})}
        {...(dialog.choices ? { choices: dialog.choices } : {})}
        error={error}
        onConfirm={onConfirm}
        onCancel={close}
      >
        {blocking && (
          <p>
            <Link to="/rollouts/$rolloutId" params={{ rolloutId: blocking.id }} className="df-row-link" onClick={close}>
              {fill(words.pausedBanner.open, { version: blocking.version })}
            </Link>
          </p>
        )}
      </ConfirmDialog>
    </>
  )
}

export const RolloutsRouteError = () => {
  const router = useRouter()
  return <RolloutsError onRetry={() => void router.invalidate()} />
}
