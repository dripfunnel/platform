import { isApiError } from '@dripfunnel/shared/graphql'
import { ConfirmDialog, initials, type ConfirmDialogProps } from '@dripfunnel/shared/ui'
import { looksLikeEmail } from '@dripfunnel/shared/format'
import { useState } from 'react'
import {
  accessLevels,
  addSupplierPerson,
  changeRole,
  inviteMember,
  inviteSupplier,
  removeMember,
  removeSupplier,
  resendInvitation,
  resumeSupplier,
  revokeInvitation,
  setApproval,
  setShippingMode,
  setSupplierAccess,
  staffRoles,
  suspendSupplier,
  type AccessLevel,
  type Person,
  type StaffRole,
  type Supplier,
} from '../../api/team'
import { fill, formatCount, formatTime, messages, plural } from '../../messages'
import { TeamRow } from '../common/TeamRow'

const words = messages.settings.team

type Ask = Omit<ConfirmDialogProps, 'open' | 'onCancel' | 'cancelLabel'>

/** The API's refusal in words, with the plan's figure or the limit's reason where it gave one. */
const refusalOf = (error: unknown): string => {
  if (!isApiError(error)) return words.refused.other
  if (error.code === 'PLAN_LIMIT' && typeof error.details['limit'] === 'number') return fill(words.planLimit, { count: formatCount(error.details['limit']) })
  return (words.refused as Record<string, string>)[error.code] ?? words.refused.other
}

/** One run of writes behind a dialog: busy while it goes, the toast after, the list read again either way. */
const useRun = (onDone: (toast: string) => void) => {
  const [busy, setBusy] = useState(false)
  const run = async (work: () => Promise<string>) => {
    setBusy(true)
    try {
      onDone(await work())
    } catch (error) {
      onDone(refusalOf(error))
    } finally {
      setBusy(false)
    }
  }
  return { busy, run }
}

const Chips = <K extends string>({ chips, current, label, onPick }: { chips: { key: K; label: string; count: number }[]; current: K; label: string; onPick: (k: K) => void }) => (
  <div className="df-team-chips" role="group" aria-label={label}>
    {chips.map((c) => (
      <button key={c.key} type="button" aria-pressed={current === c.key} onClick={() => onPick(c.key)}>
        {`${c.label} · ${formatCount(c.count)}`}
      </button>
    ))}
  </div>
)

export interface PeopleTabProps {
  people: readonly Person[]
  canEdit: boolean
  onChanged: (toast: string) => void
}

/** SetTeam, people: everyone who works in this store and the invitations waiting (#290 part 5). */
export const PeopleTab = ({ people, canEdit, onChanged }: PeopleTabProps) => {
  const [filter, setFilter] = useState<'all' | 'staff' | 'waiting'>('all')
  const [ask, setAsk] = useState<Ask | null>(null)
  const { busy, run } = useRun(onChanged)
  const members = people.filter((p) => p.kind === 'member')
  const waiting = people.filter((p) => p.kind === 'invitation')
  const shown = filter === 'staff' ? members : filter === 'waiting' ? waiting : people
  const roleName = (r: StaffRole) => words.roles[r]

  const invite = () =>
    setAsk({
      title: words.inviteTitle,
      target: '',
      consequence: words.inviteBody,
      confirmLabel: words.inviteNext,
      input: { label: words.theirEmail, type: 'email', initial: '', placeholder: words.emailPlaceholder, error: (v) => (looksLikeEmail(v) ? null : words.emailInvalid) },
      onConfirm: (_, value) => {
        const to = (value ?? '').trim()
        setAsk({
          title: fill(words.whatCanTheyDo, { email: to }),
          target: to,
          consequence: words.roleNote,
          confirmLabel: words.sendInvite,
          choices: [{ key: 'role', label: words.role, options: staffRoles.map((r) => ({ value: r, label: `${roleName(r)} — ${words.roleSubs[r]}` })), initial: 'staff', error: () => null }],
          onConfirm: (_, __, picks) => {
            const role = staffRoles.find((r) => r === picks['role']) ?? 'staff'
            void run(async () => (await inviteMember(to, role), fill(words.inviteSent, { email: to })))
          },
        })
      },
    })

  const menu = (p: Person) => {
    const label = p.name || p.email
    if (p.kind === 'invitation')
      return setAsk({
        title: label,
        target: p.email,
        consequence: p.expired ? words.expired : p.expiresAt ? fill(words.expires, { when: formatTime(p.expiresAt) }) : '',
        confirmLabel: words.continue,
        choices: [{ key: 'what', label: words.whatNow, options: [{ value: 'resend', label: words.resend }, { value: 'cancel', label: words.cancelInvite }], initial: 'resend', error: () => null }],
        onConfirm: (_, __, picks) =>
          void run(async () =>
            picks['what'] === 'cancel' ? (await revokeInvitation(p.id), words.inviteCancelled) : (await resendInvitation(p.id), fill(words.resent, { email: p.email })),
          ),
      })
    setAsk({
      title: label,
      target: `${roleName(p.role)} · ${p.email}`,
      consequence: words.roleTakesTime,
      confirmLabel: words.continue,
      choices: [{ key: 'what', label: words.whatNow, options: [{ value: 'role', label: words.changeRole }, { value: 'remove', label: words.removeFromStore }], initial: 'role', error: () => null }],
      onConfirm: (_, __, picks) =>
        picks['what'] === 'remove'
          ? setAsk({
              title: fill(words.removeTitle, { name: label }),
              target: label,
              consequence: words.removeBody,
              confirmLabel: words.remove,
              danger: true,
              onConfirm: () => void run(async () => (await removeMember(p.id), fill(words.removed, { name: label }))),
            })
          : setAsk({
              title: fill(words.roleFor, { name: label }),
              target: label,
              consequence: words.roleTakesTime,
              confirmLabel: words.changeRole,
              choices: [{ key: 'role', label: words.role, options: staffRoles.map((r) => ({ value: r, label: roleName(r) })), initial: p.role, error: () => null }],
              onConfirm: (_, __, chosen) => {
                const role = staffRoles.find((r) => r === chosen['role']) ?? p.role
                if (role !== p.role) void run(async () => (await changeRole(p.id, role), fill(words.roleChanged, { name: label, role: roleName(role) })))
              },
            }),
    })
  }

  return (
    <div className="df-team">
      <div className="df-team-head">
        <div>
          <h2>{words.peopleTitle}</h2>
          <p>{fill(words.peopleSub, { active: formatCount(members.length), waiting: formatCount(waiting.length) })}</p>
        </div>
        {canEdit && (
          <button type="button" className="df-button df-button--primary" disabled={busy} onClick={invite}>
            {words.invitePerson}
          </button>
        )}
      </div>
      <Chips
        label={words.filterPeople}
        current={filter}
        onPick={setFilter}
        chips={[
          { key: 'all', label: words.everyone, count: people.length },
          { key: 'staff', label: words.staff, count: members.length },
          { key: 'waiting', label: words.waiting, count: waiting.length },
        ]}
      />
      {shown.length === 0 ? (
        <p className="df-team-empty">{words.nobody}</p>
      ) : (
        <ul className="df-team-list" aria-label={words.peopleTitle}>
          {shown.map((p) => (
            <TeamRow
              key={p.id}
              mark={p.name ? initials(p.name) : '?'}
              square={false}
              name={p.name || p.email}
              sub={p.kind === 'invitation' ? `${p.email} · ${p.expired ? words.expiredShort : fill(words.invitedOn, { when: formatTime(p.since) })}` : `${p.email}${p.you ? ` · ${words.you}` : ''}`}
              role={roleName(p.role)}
              status={p.kind === 'invitation' ? (p.expired ? words.expiredShort : words.waitingStatus) : words.active}
              tone={p.kind === 'invitation' ? 'wait' : 'ok'}
              onMenu={canEdit && !busy ? () => menu(p) : null}
              menuLabel={fill(words.manage, { name: p.name || p.email })}
            />
          ))}
        </ul>
      )}
      <p className="df-team-foot">{words.peopleFoot}</p>
      {ask && <ConfirmDialog key={`${ask.title}|${ask.target}|${ask.confirmLabel}`} {...ask} open cancelLabel={words.cancel} onCancel={() => setAsk(null)} onConfirm={(...args) => { setAsk(null); ask.onConfirm(...args) }} />}
    </div>
  )
}

export interface SupplierTabProps {
  suppliers: readonly Supplier[]
  approval: boolean
  canEdit: boolean
  onChanged: (toast: string) => void
}

/** SetTeam, suppliers: each company, what it can do, its people and products, and the approval switch (#295 part 2). */
export const SupplierTab = ({ suppliers, approval, canEdit, onChanged }: SupplierTabProps) => {
  const [filter, setFilter] = useState<'all' | 'active' | 'suspended'>('all')
  const [ask, setAsk] = useState<Ask | null>(null)
  const { busy, run } = useRun(onChanged)
  const active = suppliers.filter((s) => s.status !== 'suspended')
  const suspended = suppliers.filter((s) => s.status === 'suspended')
  const shown = filter === 'active' ? active : filter === 'suspended' ? suspended : suppliers
  const accessName = (a: AccessLevel) => words.access[a]
  const accessChoice = (initial: AccessLevel) => ({ key: 'access', label: words.accessLabel, options: accessLevels.map((a) => ({ value: a, label: `${accessName(a)} — ${words.accessSubs[a]}` })), initial, error: () => null })
  const levelOf = (value: string | undefined): AccessLevel => accessLevels.find((a) => a === value) ?? 'vendor-catalogue'

  const invite = () =>
    setAsk({
      title: words.inviteSupplierTitle,
      target: words.step.replace('{n}', '1'),
      consequence: words.inviteSupplierBody,
      confirmLabel: words.next,
      input: { label: words.companyName, type: 'text', initial: '', placeholder: words.companyPlaceholder, error: (v) => (v.trim() === '' ? words.companyMissing : null) },
      onConfirm: (_, company) => {
        const name = (company ?? '').trim()
        setAsk({
          title: fill(words.whoGetsInvite, { name }),
          target: words.step.replace('{n}', '2'),
          consequence: words.firstUserBody,
          confirmLabel: words.next,
          input: { label: words.theirEmail, type: 'email', initial: '', placeholder: words.emailPlaceholder, error: (v) => (looksLikeEmail(v) ? null : words.emailInvalid) },
          onConfirm: (_, address) => {
            const to = (address ?? '').trim()
            setAsk({
              title: fill(words.whatCanCompanyDo, { name }),
              target: words.step.replace('{n}', '3'),
              consequence: words.neverCustomers,
              confirmLabel: words.sendTheInvite,
              choices: [accessChoice('vendor-catalogue')],
              onConfirm: (_, __, picks) => void run(async () => (await inviteSupplier({ name, email: to, accessLevel: levelOf(picks['access']) }), fill(words.supplierInvited, { email: to, name }))),
            })
          },
        })
      },
    })

  const menu = (s: Supplier) =>
    setAsk({
      title: s.name,
      target: `${accessName(s.accessLevel)} · ${fill(plural(words.users, s.users), { count: formatCount(s.users) })}`,
      consequence: '',
      confirmLabel: words.continue,
      choices: [
        {
          key: 'what',
          label: words.whatNow,
          options: [
            ...(s.status === 'suspended' ? [] : [{ value: 'add', label: words.addPerson }]),
            { value: 'access', label: words.changeAccess },
            { value: 'shipping', label: words.changeShipping },
            { value: 'suspend', label: s.status === 'suspended' ? words.resume : words.suspend },
            { value: 'remove', label: words.removeSupplier },
          ],
          initial: s.status === 'suspended' ? 'access' : 'add',
          error: () => null,
        },
      ],
      onConfirm: (_, __, picks) => {
        const what = picks['what']
        if (what === 'add')
          return setAsk({
            title: fill(words.addPersonTitle, { name: s.name }),
            target: s.name,
            consequence: fill(words.addPersonBody, { name: s.name }),
            confirmLabel: words.sendInvite,
            input: { label: words.theirEmail, type: 'email', initial: '', placeholder: words.emailPlaceholder, error: (v) => (looksLikeEmail(v) ? null : words.emailInvalid) },
            onConfirm: (_, value) => void run(async () => (await addSupplierPerson(s.id, (value ?? '').trim()), fill(words.inviteSent, { email: (value ?? '').trim() }))),
          })
        if (what === 'access')
          return setAsk({
            title: fill(words.whatCanCompanyDo, { name: s.name }),
            target: s.name,
            consequence: words.takesMinutes,
            confirmLabel: words.save,
            choices: [accessChoice(s.accessLevel)],
            onConfirm: (_, __, chosen) => {
              const level = levelOf(chosen['access'])
              if (level !== s.accessLevel) void run(async () => (await setSupplierAccess(s.id, level), fill(words.accessChanged, { name: s.name, access: accessName(level) })))
            },
          })
        if (what === 'shipping')
          return setAsk({
            title: fill(words.shippingTitle, { name: s.name }),
            target: s.name,
            consequence: words.shippingBody,
            confirmLabel: words.save,
            choices: [
              { key: 'mode', label: words.shippingLabel, options: [{ value: 'to-store', label: words.toStore }, { value: 'to-shopper', label: words.toShopper }], initial: s.shippingMode, error: () => null },
              { key: 'labels', label: words.labelsLabel, options: [{ value: 'store', label: words.labelsStore }, { value: 'own', label: words.labelsOwn }], initial: s.labelAccount ?? 'store', when: (p) => p['mode'] === 'to-shopper', error: () => null },
            ],
            onConfirm: (_, __, chosen) => {
              const mode = chosen['mode'] === 'to-shopper' ? 'to-shopper' : 'to-store'
              // Who books labels is asked only for to-shopper; to-store sends the stored one back, so it's never changed unseen.
              const labels = mode === 'to-shopper' ? (chosen['labels'] === 'own' ? 'own' : 'store') : (s.labelAccount ?? 'store')
              void run(async () => (await setShippingMode(s.id, mode, labels), fill(words.shippingChanged, { name: s.name })))
            },
          })
        if (what === 'suspend' && s.status === 'suspended') return void run(async () => (await resumeSupplier(s.id), fill(words.resumed, { name: s.name })))
        if (what === 'suspend')
          return setAsk({
            title: fill(words.suspendTitle, { name: s.name }),
            target: s.name,
            consequence: fill(plural(words.suspendBody, s.products), { count: formatCount(s.products) }),
            confirmLabel: words.suspend,
            choices: [{ key: 'hide', label: words.theirProducts, options: [{ value: 'hide', label: words.hideProducts }, { value: 'keep', label: words.keepSelling }], initial: 'hide', error: () => null }],
            onConfirm: (_, __, chosen) => {
              const hide = chosen['hide'] !== 'keep'
              void run(async () => (await suspendSupplier(s.id, hide), fill(hide ? words.suspendedHidden : words.suspended, { name: s.name })))
            },
          })
        setAsk({
          title: fill(words.removeSupplierTitle, { name: s.name }),
          target: s.name,
          consequence: fill(plural(words.removeSupplierBody, s.products), { count: formatCount(s.products) }),
          confirmLabel: words.removeSupplier,
          danger: true,
          onConfirm: () =>
            void run(async () => {
              const hidden = await removeSupplier(s.id)
              return fill(plural(words.supplierRemoved, hidden), { name: s.name, count: formatCount(hidden) })
            }),
        })
      },
    })

  const products = suppliers.reduce((n, s) => n + s.products, 0)
  return (
    <div className="df-team">
      <div className="df-team-head">
        <div>
          <h2>{words.suppliersTitle}</h2>
          <p>{fill(plural(words.suppliersSub, suppliers.length), { count: formatCount(suppliers.length), products: formatCount(products) })}</p>
        </div>
        {canEdit && (
          <button type="button" className="df-button df-button--primary" disabled={busy} onClick={invite}>
            {words.inviteSupplier}
          </button>
        )}
      </div>
      <button type="button" role="switch" aria-checked={approval} className="df-team-approval" disabled={!canEdit || busy} onClick={() => void run(async () => (await setApproval(!approval), approval ? words.approvalOff : words.approvalOn))}>
        <span aria-hidden="true" />
        <span>
          <strong>{words.approvalTitle}</strong>
          <span>{approval ? words.approvalOnSub : words.approvalOffSub}</span>
        </span>
      </button>
      <Chips
        label={words.filterSuppliers}
        current={filter}
        onPick={setFilter}
        chips={[
          { key: 'all', label: words.all, count: suppliers.length },
          { key: 'active', label: words.activeChip, count: active.length },
          { key: 'suspended', label: words.suspendedChip, count: suspended.length },
        ]}
      />
      {shown.length === 0 ? (
        <p className="df-team-empty">{suppliers.length === 0 ? words.noSuppliers : words.noneHere}</p>
      ) : (
        <ul className="df-team-list" aria-label={words.suppliersTitle}>
          {shown.map((s) => (
            <TeamRow
              key={s.id}
              mark={initials(s.name) || '?'}
              square
              name={s.name}
              sub={`${fill(plural(words.users, s.users), { count: formatCount(s.users) })} · ${fill(plural(words.products, s.products), { count: formatCount(s.products) })}`}
              role={accessName(s.accessLevel)}
              status={words.supplierStatus[s.status]}
              tone={s.status === 'active' ? 'ok' : s.status === 'invited' ? 'wait' : 'off'}
              onMenu={canEdit && !busy ? () => menu(s) : null}
              menuLabel={fill(words.manage, { name: s.name })}
            />
          ))}
        </ul>
      )}
      <p className="df-team-foot">{words.suppliersFoot}</p>
      {ask && <ConfirmDialog key={`${ask.title}|${ask.target}|${ask.confirmLabel}`} {...ask} open cancelLabel={words.cancel} onCancel={() => setAsk(null)} onConfirm={(...args) => { setAsk(null); ask.onConfirm(...args) }} />}
    </div>
  )
}
