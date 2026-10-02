import { getRouteApi, useRouter, useRouterState } from '@tanstack/react-router'
import { useCallback, useState } from 'react'
import { changeStaffRole, inviteStaff, removeStaff, resendStaffInvite, revokeStaffInvite, type StaffMember, type StaffResult } from '../../api/staff'
import { messages } from '../../messages'
import { ConfirmDialog, useScreenState, Toast } from '@dripfunnel/shared/ui'
import { harnessEnabled } from '../../harness'
import { callerFor } from '../common/harnessCaller'
import { Staff, StaffError } from './Staff'
import { refusalOn, type PageRefusal } from './pageRefusal'
import { isStaffRole, labelOf, refusalText, staffDialog, staffToast, type StaffDialogKind } from './staffDialog'
import { staffStates } from './staffHarness'

const staffRoute = getRouteApi('/_app/staff')
const shellRoute = getRouteApi('/_app')

interface Pending {
  kind: StaffDialogKind
  member: StaffMember | null
}

export const StaffScreen = () => {
  const page = staffRoute.useLoaderData()
  const { me } = shellRoute.useLoaderData()
  const searchStr = useRouterState({ select: (state) => state.location.searchStr })
  const forced = useScreenState(staffStates, harnessEnabled)
  const router = useRouter()
  const caller = callerFor(me.role, searchStr)
  const [pending, setPending] = useState<Pending | null>(() => (forced === 'confirm' ? { kind: 'invite', member: null } : null))
  const [toast, setToast] = useState<string | null>(null)
  const [refusal, setRefusal] = useState<PageRefusal | null>(() =>
    forced === 'refused' ? { text: refusalText('LAST_SUPER_ADMIN', me.name), search: searchStr } : null,
  )
  const clearToast = useCallback(() => setToast(null), [])

  const run = (kind: StaffDialogKind, member: StaffMember | null, email: string | null, role: string | null): Promise<StaffResult> => {
    const picked = role !== null && isStaffRole(role) ? role : null
    if (kind === 'invite') return email && picked ? inviteStaff(email, picked, caller) : Promise.reject(new Error('Invite needs an email and a role.'))
    if (!member) return Promise.reject(new Error(`${kind} needs a staff member.`))
    switch (kind) {
      case 'changeRole':
        return picked ? changeStaffRole(member.id, picked, caller) : Promise.reject(new Error('Change role needs a role.'))
      case 'remove':
        return removeStaff(member.id, caller)
      case 'resend':
        return resendStaffInvite(member.id, caller)
      case 'revoke':
        return revokeStaffInvite(member.id, caller)
    }
  }

  // A refusal is the server's specific answer, shown in place of the change, never as "failed".
  const onConfirm = ({ kind, member }: Pending, email: string | null, role: string | null) => {
    setPending(null)
    setRefusal(null)
    const name = member ? labelOf(member) : (email ?? '')
    run(kind, member, email, role)
      .then((result) => {
        if (result.ok) setToast(staffToast(kind, { name, email: member?.email ?? email ?? '', role: role ?? '' }))
        else setRefusal({ text: refusalText(result.reason, name), search: searchStr })
        return router.invalidate()
      })
      .catch(() => setToast(messages.staff.toasts.failed))
  }

  const dialog = pending ? staffDialog(pending.kind, pending.member, me.id) : null

  return (
    <>
      <Staff
        page={page}
        forced={forced}
        me={{ id: me.id, role: caller }}
        refusal={refusalOn(refusal, searchStr)}
        onInvite={() => setPending({ kind: 'invite', member: null })}
        onAction={(kind, member) => setPending({ kind, member })}
        onReload={() => {
          setRefusal(null)
          void router.invalidate()
        }}
      />
      <ConfirmDialog
        open={dialog !== null}
        title={dialog?.title ?? ''}
        target={dialog?.target ?? ''}
        consequence={dialog?.consequence ?? ''}
        confirmLabel={dialog?.confirmLabel ?? ''}
        cancelLabel={messages.staff.dialogs.cancel}
        {...(dialog?.notes ? { notes: dialog.notes } : {})}
        {...(dialog?.input ? { input: dialog.input } : {})}
        {...(dialog?.choices ? { choices: dialog.choices } : {})}
        danger={dialog?.danger ?? false}
        onConfirm={(_reason, email, { role }) => pending && onConfirm(pending, email, role ?? null)}
        onCancel={() => setPending(null)}
      />
      <Toast message={toast} onDone={clearToast} />
    </>
  )
}

export const StaffRouteError = () => {
  const router = useRouter()
  return <StaffError onRetry={() => void router.invalidate()} />
}
