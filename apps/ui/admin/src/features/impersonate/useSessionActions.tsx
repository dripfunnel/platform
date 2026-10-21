import { useCallback, useState } from 'react'
import { endSession, extendImpersonation, impersonationMinutes, type StaffSession } from '../../api/impersonation'
import { fill, formatTime, messages } from '../../messages'
import { ConfirmDialog, Toast } from '@dripfunnel/shared/ui'
import type { StaffRole } from '../shell/staffRoles'
import { firstOf, refusalText, sessionPlace } from './sessionText'
import { sessionsChanged } from './sessionEvents'

const words = messages.impersonate
const minuteMs = 60_000

type Pending = { action: 'end' | 'extend'; session: StaffSession }

const extendedUntil = (session: StaffSession) => new Date(Date.parse(session.expiresAt) + impersonationMinutes * minuteMs).toISOString()

const dialogFor = ({ action, session }: Pending) => {
  const dialogs = words.dialogs
  if (action === 'extend') return { ...dialogs.extend, consequence: fill(dialogs.extend.consequence, { time: formatTime(extendedUntil(session)) }) }
  if (session.kind === 'setup') {
    const values = { partner: session.partner.name, staff: firstOf(session.staff.name) }
    return { title: fill(dialogs.endSetup.title, values), consequence: fill(dialogs.endSetup.consequence, values), confirm: dialogs.endSetup.confirm }
  }
  const where = sessionPlace(session)
  if (session.mine) return { ...dialogs.endMine, consequence: fill(dialogs.endMine.consequence, { where }) }
  const values = { staff: firstOf(session.staff.name), target: firstOf(session.target?.name ?? ''), where }
  return { title: fill(dialogs.endOther.title, values), consequence: fill(dialogs.endOther.consequence, values), confirm: dialogs.endOther.confirm }
}

// End and Extend, each confirmed first, as the API allows them on the session (ACCESS.md §8.3).
export const useSessionActions = (caller: StaffRole, onChanged: () => void) => {
  const [pending, setPending] = useState<Pending | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const clearToast = useCallback(() => setToast(null), [])

  const run = ({ action, session }: Pending) => {
    setPending(null)
    const request = action === 'end' ? endSession(session.id) : extendImpersonation(session.id)
    request
      .then((result) => {
        if (!result.ok) setToast(refusalText(result.reason))
        else setToast(action === 'end' ? words.toasts.ended : fill(words.toasts.extended, { time: formatTime(extendedUntil(session)) }))
        sessionsChanged()
        onChanged()
      })
      .catch(() => setToast(words.toasts.failed))
  }

  const dialog = pending ? dialogFor(pending) : null
  const element = (
    <>
      <ConfirmDialog
        open={dialog !== null}
        title={dialog?.title ?? ''}
        target={pending ? fill(words.session.title, { id: pending.session.id }) : ''}
        consequence={dialog?.consequence ?? ''}
        confirmLabel={dialog?.confirm ?? ''}
        cancelLabel={words.dialogs.cancel}
        danger={pending?.action === 'end'}
        onConfirm={() => pending && run(pending)}
        onCancel={() => setPending(null)}
      />
      <Toast message={toast} onDone={clearToast} />
    </>
  )

  return { request: (action: Pending['action'], session: StaffSession) => setPending({ action, session }), element }
}
