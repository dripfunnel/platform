import { looksLikeEmail } from '@dripfunnel/shared/format'
import { ConfirmDialog, EmptyState, ErrorState, initials, LoadingState, PermissionDenied, Toast, useScreenState, type ConfirmDialogProps } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/states.css'
import { getRouteApi } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { changeTeamRole, inviteTeammate, loadMyTeam, removeTeammate, resendTeamInvitation, revokeTeamInvitation, teamRoles, type TeamRole, type Teammate } from '../../api/supplierTeam'
import { harnessEnabled } from '../../harness'
import { fill, formatTime, messages } from '../../messages'
import { supplierTiers, type SupplierTier } from '../../nav'
import { refusalIn } from '../common/refusal'
import { TeamRow } from '../common/TeamRow'
import { teamSample, teamStates, type TeamState } from './teamStates'
import './supplierTeam.css'

const words = messages.supplierTeam
const accessNames = messages.settings.team.access
const shellRoute = getRouteApi('/_app')
const refused = refusalIn(words.refused)

type View = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; team: Teammate[] }
type Ask = Omit<ConfirmDialogProps, 'open' | 'onCancel' | 'cancelLabel' | 'error'>

interface TeamSeat {
  canManage: boolean
  supplier: boolean
  readOnly: boolean
  tier: SupplierTier
}

// `supplier.team` is a Supplier admin's alone (ACCESS §5.2, §7.5); the API refuses everyone else as well.
const seatOf = (forced: TeamState | null, acting: { permissions: readonly string[]; seller: unknown; tier: string | null }, readOnly: boolean): TeamSeat => {
  const tier = supplierTiers.find((t) => t === acting.tier) ?? 'vendor-catalogue'
  if (forced === 'denied') return { canManage: false, supplier: true, readOnly: false, tier }
  if (forced) return { canManage: true, supplier: true, readOnly: forced === 'readOnly', tier }
  const supplier = acting.seller !== null
  return { canManage: supplier && acting.permissions.includes('supplier.team'), supplier, readOnly, tier }
}

const nameOf = (t: Teammate) => t.name || t.email

/** An invitation has no name yet, so its line says how long its link works rather than the email again. */
const subOf = (t: Teammate): string => {
  if (t.name) return t.email
  if (t.kind === 'member') return ''
  return t.expiresAt && !t.expired ? fill(words.linkUntil, { when: formatTime(t.expiresAt) }) : words.status.expired
}

/** Your team (VendorViews "team", FIRST-RELEASE §17): a Supplier admin's own people and invitations; ?state= per teamStates.ts. */
export const TeamPage = () => {
  const { acting, state } = shellRoute.useLoaderData()
  const forced = useScreenState(teamStates, harnessEnabled)
  const sample = useMemo(() => teamSample(forced), [forced])
  const seat = useMemo(() => seatOf(forced, acting, state?.readOnly ?? false), [forced, acting, state])
  const supplier = acting.seller?.name ?? ''
  const store = acting.store.name

  const [view, setView] = useState<View>({ kind: 'loading' })
  const [ask, setAsk] = useState<(Ask & { id: number }) | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const latest = useRef(0)
  const asks = useRef(0)

  // Only the latest read answers: one started before a change never replaces the list after it.
  const load = useCallback(() => {
    const mine = ++latest.current
    if (forced === 'loading') return setView({ kind: 'loading' })
    if (forced === 'error') return setView({ kind: 'error' })
    if (sample) return setView({ kind: 'ready', team: sample })
    if (!seat.canManage) return
    setView((current) => (current.kind === 'error' ? { kind: 'loading' } : current))
    void loadMyTeam().then(
      (team) => {
        if (mine === latest.current) setView({ kind: 'ready', team })
      },
      () => {
        if (mine === latest.current) setView({ kind: 'error' })
      },
    )
  }, [forced, sample, seat.canManage])
  useEffect(load, [load])

  // Each dialog starts without an error and leaves with it; a refusal stays in the dialog that asked.
  const open = (next: Ask | null) => {
    setError(null)
    setAsk(next && { ...next, id: ++asks.current })
  }

  const run = async (work: () => Promise<string>) => {
    setError(null)
    try {
      const done = await work()
      open(null)
      setToast(done)
      load()
    } catch (failure) {
      setError(refused(failure))
    }
  }

  const roleName = (role: TeamRole) => words.roles[role]
  const act = (work: () => Promise<void>, done: string) => void run(async () => (await work(), done))

  const invite = () =>
    open({
      title: fill(words.inviteTitle, { supplier }),
      target: '',
      consequence: fill(words.inviteBody, { supplier }),
      confirmLabel: words.sendInvite,
      input: { label: words.theirEmail, type: 'email', initial: '', placeholder: words.emailPlaceholder, error: (v) => (looksLikeEmail(v) ? null : words.emailInvalid) },
      choices: [
        {
          key: 'role',
          label: words.roleLabel,
          options: [
            { value: 'supplier-member', label: `${roleName('supplier-member')} — ${accessNames[seat.tier]}` },
            { value: 'supplier-admin', label: `${roleName('supplier-admin')} — ${words.adminSub}` },
          ],
          initial: 'supplier-member',
          error: () => null,
        },
      ],
      onConfirm: (_, value, picks) => {
        const email = (value ?? '').trim()
        const role = teamRoles.find((r) => r === picks['role']) ?? 'supplier-member'
        act(() => inviteTeammate(email, role), fill(words.sent, { email }))
      },
    })

  const menu = (t: Teammate) => {
    const name = nameOf(t)
    if (t.kind === 'invitation')
      return open({
        title: name,
        target: t.email,
        consequence: '',
        confirmLabel: words.go,
        choices: [{ key: 'what', label: words.whatNow, options: [{ value: 'resend', label: words.resend }, { value: 'cancel', label: words.cancelInvite }], initial: 'resend', error: () => null }],
        onConfirm: (_, __, picks) =>
          picks['what'] === 'cancel' ? act(() => revokeTeamInvitation(t.id), fill(words.cancelled, { email: t.email })) : act(() => resendTeamInvitation(t.id), fill(words.resent, { email: t.email })),
      })
    if (t.lastAdmin) return open({ title: name, target: t.email, consequence: words.lastAdmin, confirmLabel: words.ok, onConfirm: () => open(null) })
    const other: TeamRole = t.role === 'supplier-admin' ? 'supplier-member' : 'supplier-admin'
    open({
      title: name,
      target: `${roleName(t.role)} · ${t.email}`,
      consequence: '',
      confirmLabel: words.go,
      choices: [{ key: 'what', label: words.whatNow, options: [{ value: 'role', label: other === 'supplier-admin' ? words.makeAdmin : words.makeMember }, { value: 'remove', label: fill(words.remove, { supplier }) }], initial: 'role', error: () => null }],
      onConfirm: (_, __, picks) =>
        picks['what'] === 'remove'
          ? open({
              title: fill(words.removeTitle, { name, supplier }),
              target: name,
              consequence: fill(words.removeBody, { store }),
              confirmLabel: words.removeConfirm,
              danger: true,
              onConfirm: () => act(() => removeTeammate(t.id), fill(words.removed, { name })),
            })
          : act(() => changeTeamRole(t.id, other), fill(other === 'supplier-admin' ? words.nowAdmin : words.nowMember, { name })),
    })
  }

  if (!seat.canManage)
    return (
      <div className="df-steam">
        <h1 className="df-page-title">{words.title}</h1>
        <EmptyState title={words.denied.title} body={seat.supplier ? fill(words.denied.supplier, { supplier }) : words.denied.merchant} />
      </div>
    )

  const team = view.kind === 'ready' ? view.team : []
  const canChange = !seat.readOnly

  return (
    <div className="df-steam">
      <div className="df-steam-head">
        <div>
          <h1 className="df-page-title">{words.title}</h1>
          <p className="df-page-lede">{fill(words.sub, { supplier, store })}</p>
        </div>
        {view.kind === 'ready' && canChange && (
          <button type="button" className="df-button df-button--primary" onClick={invite}>
            {words.invite}
          </button>
        )}
      </div>
      {view.kind === 'ready' && !canChange && <PermissionDenied actionLabel={words.invite} reason={words.readOnly} />}

      {view.kind === 'loading' && <LoadingState label={words.loading} />}
      {view.kind === 'error' && <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry: load }} />}

      {view.kind === 'ready' && (
        <>
          <ul className="df-team-list" aria-label={words.list}>
            {team.map((t) => (
              <TeamRow
                key={t.id}
                mark={initials(t.name ?? t.email.split('@')[0] ?? '') || '?'}
                square={false}
                name={nameOf(t)}
                sub={subOf(t)}
                role={roleName(t.role)}
                status={t.kind === 'invitation' ? (t.expired ? words.status.expired : words.status.invited) : t.you ? words.status.you : words.status.active}
                tone={t.kind === 'invitation' ? (t.expired ? 'off' : 'wait') : 'quiet'}
                onMenu={canChange ? () => menu(t) : null}
                menuLabel={fill(words.manage, { name: nameOf(t) })}
              />
            ))}
          </ul>
          {team.every((t) => t.you) && <p className="df-team-empty">{fill(words.alone, { supplier })}</p>}
          <p className="df-steam-foot">{fill(words.foot, { supplier, store })}</p>
        </>
      )}
      {ask && <ConfirmDialog key={ask.id} {...ask} open error={error} cancelLabel={words.cancel} onCancel={() => open(null)} />}
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  )
}
