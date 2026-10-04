import { Toast, useCurrentStaffSession, useScreenState } from '@dripfunnel/shared/ui'
import { getRouteApi, useRouter } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { changeTeamRole, inviteTeamMember, loadMoreTeam, removeTeamMember, resendTeamInvite, revokeTeamInvite, setSecondFactorPolicy, transferOwnership, type TeamMember, type TeamResult } from '../../api/settings'
import { staffSession } from '../../api/staffSession'
import { harnessEnabled } from '../../harness'
import { fill, messages } from '../../messages'
import { CompanyTab } from './CompanyTab'
import { PayoutTab } from './PayoutTab'
import { SecurityTab } from './SecurityTab'
import { Settings, SettingsError, SettingsLoading } from './Settings'
import { settingsStates } from './settingsHarness'
import { TeamTab, type TeamAction } from './TeamTab'

const settingsRoute = getRouteApi('/_app/settings')
const shellRoute = getRouteApi('/_app')
const team = messages.settings.team
const roleNames = messages.shell.roles

const run = (action: TeamAction): Promise<TeamResult> => {
  switch (action.kind) {
    case 'invite':
      return inviteTeamMember({ name: action.name, email: action.email, role: action.role })
    case 'role':
      return changeTeamRole(action.member.id, action.role)
    case 'remove':
      return removeTeamMember(action.member.id)
    case 'resend':
      return resendTeamInvite(action.member.id)
    case 'revoke':
      return revokeTeamInvite(action.member.id)
    case 'transfer':
      return transferOwnership(action.member.id)
  }
}

const doneText = (action: TeamAction): string => {
  switch (action.kind) {
    case 'invite':
      return fill(team.toasts.invited, { email: action.email })
    case 'role':
      return fill(team.toasts.role, { name: action.member.name, role: roleNames[action.role] })
    case 'remove':
      return fill(team.toasts.removed, { name: action.member.name })
    case 'resend':
      return fill(team.toasts.resent, { email: action.member.email })
    case 'revoke':
      return fill(team.toasts.revoked, { name: action.member.name })
    case 'transfer':
      return fill(team.toasts.transferred, { name: action.member.name })
  }
}

export const SettingsScreen = () => {
  const data = settingsRoute.useLoaderData()
  const { tab = 'company' } = settingsRoute.useSearch()
  const { me } = shellRoute.useLoaderData()
  const forced = useScreenState(settingsStates, harnessEnabled)
  const router = useRouter()
  const session = useCurrentStaffSession(staffSession)
  const [toast, setToast] = useState<string | null>(null)
  const clearToast = useCallback(() => setToast(null), [])
  const [busy, setBusy] = useState(false)
  const [extra, setExtra] = useState<{ items: readonly TeamMember[]; endCursor: string | null; more: boolean } | null>(null)
  const [moreState, setMoreState] = useState<'idle' | 'busy' | 'failed'>('idle')
  const loaded = useRef(data)
  useEffect(() => {
    loaded.current = data
    setExtra(null)
    setMoreState('idle')
  }, [data])

  if (forced === 'loading') return <SettingsLoading />
  if (forced === 'error') return <SettingsError onRetry={() => void router.invalidate()} />
  const readOnly = me.role === 'partner-read-only' || forced === 'readonly'
  const members = extra ?? { items: data.team.items, endCursor: data.team.pageInfo.endCursor, more: data.team.pageInfo.hasNextPage }

  // Each change answers here: its toast, or its refusal in words; the page then reads the team again.
  const onRun = (action: TeamAction): Promise<boolean> => {
    setBusy(true)
    return run(action)
      .then((result) => {
        setToast(result.ok ? doneText(action) : fill(team.refusals[result.reason], { email: action.kind === 'invite' ? action.email : '' }))
        return result.ok
      })
      .catch(() => {
        setToast(team.toasts.failed)
        return false
      })
      .finally(() => {
        setBusy(false)
        void router.invalidate()
      })
  }

  const onMore = () => {
    if (!members.endCursor) return
    const asked = data
    setMoreState('busy')
    loadMoreTeam(members.endCursor).then(
      (next) => {
        if (loaded.current !== asked) return
        setExtra({ items: [...members.items, ...next.items], endCursor: next.pageInfo.endCursor, more: next.pageInfo.hasNextPage })
        setMoreState('idle')
      },
      () => loaded.current === asked && setMoreState('failed'),
    )
  }

  const onPolicy = (required: boolean) => {
    setBusy(true)
    setSecondFactorPolicy(required)
      .then((result) => setToast(result.ok ? messages.settings.security.saved[required ? 'on' : 'off'] : team.refusals[result.reason]))
      .catch(() => setToast(team.toasts.failed))
      .finally(() => {
        setBusy(false)
        void router.invalidate()
      })
  }

  return (
    <>
      <Settings tab={tab} readOnly={readOnly}>
        {tab === 'company' && <CompanyTab company={data.company} />}
        {tab === 'team' && (
          <TeamTab team={members.items} role={me.role} session={session && session.state === 'open' ? session.kind : null} readOnly={readOnly} busy={busy} more={{ show: members.more, busy: moreState === 'busy', failed: moreState === 'failed' }} onRun={onRun} onMore={onMore} />
        )}
        {tab === 'payout' && <PayoutTab setupSession={session?.kind === 'setup'} partner={me.partner.name} />}
        {tab === 'security' && <SecurityTab required={data.company.secondFactorRequired} team={members.items} isOwner={me.role === 'partner-owner' && !readOnly} busy={busy} session={session} onChange={onPolicy} />}
      </Settings>
      <Toast message={toast} onDone={clearToast} />
    </>
  )
}

export const SettingsRouteError = () => {
  const router = useRouter()
  return <SettingsError onRetry={() => void router.invalidate()} />
}
