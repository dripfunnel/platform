import { ActionControl, ConfirmDialog, PermissionDenied, StatusPill, type ConfirmDialogProps } from '@dripfunnel/shared/ui'
import { looksLikeEmail } from '@dripfunnel/shared/format'
import { useId, useState, type FormEvent } from 'react'
import type { TeamMember } from '../../api/settings'
import { fill, formatTime, messages } from '../../messages'
import { partnerRoles, type PartnerRole } from '../shell/partnerRoles'
import { inviteFrom, mayManage, ownerBlock, removeRefusal, roleRefusal, rolesFor, transferCandidates, type StaffSessionKind } from './teamRules'

const words = messages.settings.team
const roleNames: Record<PartnerRole, string> = messages.shell.roles

export type TeamAction =
  | { kind: 'invite'; name: string; email: string; role: PartnerRole }
  | { kind: 'role'; member: TeamMember; role: PartnerRole }
  | { kind: 'remove'; member: TeamMember }
  | { kind: 'resend'; member: TeamMember }
  | { kind: 'revoke'; member: TeamMember }
  | { kind: 'transfer'; member: TeamMember }

export type Pending = Exclude<TeamAction, { kind: 'invite' }> | { kind: 'transferPick' }

// What confirming a dialog runs: the action itself, or for Transfer ownership the member picked.
export const actionOnConfirm = (pending: Pending, team: readonly TeamMember[], choices: Readonly<Record<string, string>>): TeamAction | null => {
  if (pending.kind !== 'transferPick') return pending
  const member = transferCandidates(team).find((m) => m.id === choices['to'])
  return member ? { kind: 'transfer', member } : null
}

const lastSeen = (member: TeamMember): string => {
  if (member.status === 'invited') return member.invitation?.expired ? words.expired : words.invited
  return member.lastSignInAt ? formatTime(member.lastSignInAt) : words.never
}

const InviteForm = ({ role, session, busy, onSend, onCancel }: { role: PartnerRole; session: StaffSessionKind; busy: boolean; onSend: (input: { name: string; email: string; role: PartnerRole }) => void; onCancel: () => void }) => {
  const ids = { name: useId(), email: useId(), role: useId(), error: useId() }
  const roles = rolesFor(role, partnerRoles, session)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [chosen, setChosen] = useState<PartnerRole>('partner-support')
  const [invalid, setInvalid] = useState(false)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const input = inviteFrom(name, email, chosen)
    if (!input) return setInvalid(true)
    setInvalid(false)
    onSend(input)
  }
  return (
    <form className="df-panel df-settings-invite" aria-labelledby="invite-title" onSubmit={submit} noValidate>
      <h2 id="invite-title">{words.inviteForm.title}</h2>
      {invalid && (
        <p id={ids.error} role="alert" className="df-field-error">
          {words.inviteForm.invalid}
        </p>
      )}
      <div className="df-settings-invite-row">
        <div className="df-field">
          <label htmlFor={ids.name}>{words.inviteForm.name}</label>
          <input id={ids.name} type="text" autoComplete="off" maxLength={120} value={name} aria-invalid={invalid && !name.trim()} aria-describedby={invalid ? ids.error : undefined} onChange={(event) => (setName(event.target.value), setInvalid(false))} />
        </div>
        <div className="df-field">
          <label htmlFor={ids.email}>{words.inviteForm.email}</label>
          <input id={ids.email} type="email" autoComplete="off" maxLength={254} value={email} aria-invalid={invalid && !looksLikeEmail(email)} aria-describedby={invalid ? ids.error : undefined} onChange={(event) => (setEmail(event.target.value), setInvalid(false))} />
        </div>
        <div className="df-field">
          <label htmlFor={ids.role}>{words.inviteForm.role}</label>
          <select id={ids.role} value={chosen} onChange={(event) => setChosen(roles.find((r) => r === event.target.value) ?? chosen)}>
            {roles.map((r) => (
              <option key={r} value={r}>
                {roleNames[r]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="df-muted">{words.inviteForm.consequence}</p>
      <div className="df-settings-invite-actions">
        <button type="submit" className="df-button df-button--primary" disabled={busy}>
          {busy ? words.inviteForm.sending : words.inviteForm.send}
        </button>
        <button type="button" className="df-button" onClick={onCancel}>
          {words.inviteForm.cancel}
        </button>
      </div>
    </form>
  )
}

export const dialogFor = (pending: Pending, team: readonly TeamMember[]): Omit<ConfirmDialogProps, 'open' | 'onConfirm' | 'onCancel' | 'cancelLabel'> => {
  const d = words.dialogs
  switch (pending.kind) {
    case 'role':
      return { title: fill(d.role.title, { name: pending.member.name }), target: pending.member.name, consequence: fill(d.role.consequence, { name: pending.member.name, role: roleNames[pending.role] }), confirmLabel: d.role.confirm }
    case 'remove':
      return { title: fill(d.remove.title, { name: pending.member.name }), target: pending.member.name, consequence: fill(d.remove.consequence, { name: pending.member.name }), confirmLabel: d.remove.confirm, danger: true }
    case 'resend':
      return { title: fill(d.resend.title, { name: pending.member.name }), target: pending.member.name, consequence: fill(d.resend.consequence, { email: pending.member.email }), confirmLabel: d.resend.confirm }
    case 'revoke':
      return { title: fill(d.revoke.title, { name: pending.member.name }), target: pending.member.name, consequence: fill(d.revoke.consequence, { email: pending.member.email }), confirmLabel: d.revoke.confirm, danger: true }
    case 'transfer':
    case 'transferPick': {
      const candidates = transferCandidates(team)
      return {
        title: d.transfer.title,
        target: d.transfer.target,
        consequence: d.transfer.consequence,
        confirmLabel: d.transfer.confirm,
        choices: [{ key: 'to', label: d.transfer.pick, options: candidates.map((m) => ({ value: m.id, label: `${m.name} · ${roleNames[m.role]}` })), initial: candidates[0]?.id ?? '', error: (value) => (value ? null : d.transfer.none) }],
        typeToConfirm: { label: d.transfer.typeLabel, hint: d.transfer.typeHint, expected: d.transfer.expected },
        danger: true,
      }
    }
  }
}

export interface TeamTabProps {
  team: readonly TeamMember[]
  role: PartnerRole
  // A staff session never changes who is Owner (ACCESS.md §8.1, §8.2): those controls say so up front.
  session: StaffSessionKind
  readOnly: boolean
  busy: boolean
  more: { show: boolean; busy: boolean; failed: boolean }
  onRun: (action: TeamAction) => Promise<boolean>
  onMore: () => void
}

// Team (§14.2): every change through a confirmation that says what happens, each refused control
// with its reason; the API decides again under the team lock.
export const TeamTab = ({ team, role, session, readOnly, busy, more, onRun, onMore }: TeamTabProps) => {
  const [pending, setPending] = useState<Pending | null>(null)
  const [inviting, setInviting] = useState(false)
  const manage = mayManage(role) && !readOnly
  const run = (action: TeamAction) => void onRun(action).then((done) => done && action.kind === 'invite' && setInviting(false))
  const confirm = (choices: Readonly<Record<string, string>>) => {
    const action = pending && actionOnConfirm(pending, team, choices)
    if (action) run(action)
    setPending(null)
  }
  return (
    <div className="df-panels">
      <section className="df-panel df-panel--wide" aria-labelledby="settings-team">
        <div className="df-settings-team-head">
          <h2 id="settings-team">{words.title}</h2>
          <div className="df-settings-team-actions">
            <ActionControl label={words.transfer} refusal={ownerBlock(session) ?? (role === 'partner-owner' && !readOnly ? null : words.refused.transfer)} disabled={busy} onRun={() => setPending({ kind: 'transferPick' })} />
            {manage ? (
              <button type="button" className="df-button df-button--primary" disabled={busy} onClick={() => setInviting(true)}>
                {words.invite}
              </button>
            ) : (
              <PermissionDenied actionLabel={words.invite} reason={words.refused.manage} />
            )}
          </div>
        </div>
        <table className="df-settings-team">
          <caption className="df-visually-hidden">{words.label}</caption>
          <thead>
            <tr>
              <th scope="col">{words.name}</th>
              <th scope="col">{words.role}</th>
              <th scope="col">{words.lastSignIn}</th>
              <th scope="col">{words.twoFactor}</th>
              <th scope="col">{words.actions}</th>
            </tr>
          </thead>
          <tbody>
            {team.map((member) => {
              const roleWhy = readOnly ? words.refused.manage : roleRefusal(member, team, role, session)
              const removeWhy = readOnly ? words.refused.manage : removeRefusal(member, team, role, session)
              const roleWhyId = `role-why-${member.id}`
              return (
                <tr key={member.id}>
                  <td data-label={words.name}>
                    <strong>{member.you ? fill(words.you, { name: member.name }) : member.name}</strong>
                    <span className="df-muted df-settings-email">{member.email}</span>
                  </td>
                  <td data-label={words.role}>
                    <select
                      aria-label={fill(words.roleOf, { name: member.name })}
                      aria-describedby={roleWhy ? roleWhyId : undefined}
                      value={member.role}
                      disabled={roleWhy !== null || busy}
                      onChange={(event) => {
                        const next = partnerRoles.find((r) => r === event.target.value)
                        if (next && next !== member.role) setPending({ kind: 'role', member, role: next })
                      }}
                    >
                      {(roleWhy === null ? rolesFor(role, partnerRoles, session) : partnerRoles).map((r) => (
                        <option key={r} value={r}>
                          {roleNames[r]}
                        </option>
                      ))}
                    </select>
                    {roleWhy && roleWhy !== words.refused.manage && (
                      <span id={roleWhyId} className="df-muted df-settings-why">
                        {roleWhy}
                      </span>
                    )}
                  </td>
                  <td data-label={words.lastSignIn}>{lastSeen(member)}</td>
                  <td data-label={words.twoFactor}>
                    <StatusPill tone={member.secondFactor ? 'success' : 'warning'} icon={member.secondFactor ? 'shield' : 'alert'} label={member.secondFactor ? words.on : words.off} />
                  </td>
                  <td data-label={words.actions}>
                    <span className="df-settings-row-actions">
                      {member.status === 'invited' && manage && (
                        <>
                          <button type="button" className="df-button df-button--small" disabled={busy} onClick={() => setPending({ kind: 'resend', member })}>
                            {words.resend}
                          </button>
                          <button type="button" className="df-button df-button--small" disabled={busy} onClick={() => setPending({ kind: 'revoke', member })}>
                            {words.revoke}
                          </button>
                        </>
                      )}
                      <ActionControl label={words.remove} refusal={removeWhy} disabled={busy} onRun={() => setPending({ kind: 'remove', member })} />
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {more.failed && <p role="alert">{words.moreFailed}</p>}
        {more.show && (
          <div className="df-show-more">
            <button type="button" className="df-button" disabled={more.busy} onClick={onMore}>
              {words.showMore}
            </button>
          </div>
        )}
      </section>
      {inviting && manage && <InviteForm role={role} session={session} busy={busy} onSend={(input) => run({ kind: 'invite', ...input })} onCancel={() => setInviting(false)} />}
      {pending && (
        <ConfirmDialog
          open
          {...dialogFor(pending, team)}
          cancelLabel={words.dialogs.cancel}
          onConfirm={(_reason, _value, choices) => confirm(choices)}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  )
}
