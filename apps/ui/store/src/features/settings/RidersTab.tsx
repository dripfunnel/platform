import { isApiError } from '@dripfunnel/shared/graphql'
import { ConfirmDialog, initials, type ConfirmDialogProps } from '@dripfunnel/shared/ui'
import { useRef, useState } from 'react'
import type { PageOf } from '../../api/allPages'
import { eraseRider, inviteRider, loadRiders, removeRider, requestRiderExport, restoreRider, resendRiderInvitation, suspendRider, type Rider, type RiderStatus } from '../../api/riders'
import { fill, formatCount, messages } from '../../messages'
import { startListExport } from '../common/listExport'
import { refusalIn } from '../common/refusal'
import '../common/teamRow.css'
import { isMobile, toE164 } from './riderPhone'
import './riders.css'

const words = messages.settings.riders

type Ask = Omit<ConfirmDialogProps, 'open' | 'onCancel' | 'cancelLabel'> & { stayOpen?: boolean }

const tones: Record<RiderStatus, string> = { active: 'ok', invited: 'wait', suspended: 'off' }

const otherRefusal = refusalIn(words.refused)

/** PLAN_LIMIT carries both own delivery and the rider limit, told apart by its key; every other code is the shared lookup. */
const refusalOf = (error: unknown): string => {
  if (isApiError(error) && error.code === 'PLAN_LIMIT') {
    const limit = error.details['limit']
    if (error.details['key'] === 'riders') return typeof limit === 'number' ? fill(words.refused.riderLimit, { count: formatCount(limit) }) : words.refused.riderLimitNoCount
    return words.refused.notInPlan
  }
  return otherRefusal(error)
}

export interface RidersTabProps {
  first: PageOf<Rider>
  canEdit: boolean
  onChanged: (toast: string) => void
}

/** SetRiders: the Owner's own delivery people, with invite, resend, suspend, restore, remove (#844), export and erase (#874). */
export const RidersTab = ({ first, canEdit, onChanged }: RidersTabProps) => {
  const [page, setPage] = useState(first)
  const [more, setMore] = useState<'idle' | 'busy' | 'failed'>('idle')
  const [ask, setAsk] = useState<Ask | null>(null)
  const [busy, setBusy] = useState(false)
  const riders = page.nodes

  const inFlight = useRef(false)

  /** A write behind a dialog; a refusal goes to `refused`, else to the toast. One write at a time, however fast the clicks. */
  const run = async (work: () => Promise<string>, refused?: (text: string) => void) => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    try {
      onChanged(await work())
    } catch (error) {
      if (refused) refused(refusalOf(error))
      else onChanged(refusalOf(error))
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  const showMore = async () => {
    if (!page.pageInfo.endCursor) return
    setMore('busy')
    try {
      const next = await loadRiders(page.pageInfo.endCursor)
      setPage({ nodes: [...page.nodes, ...next.nodes], pageInfo: next.pageInfo })
      setMore('idle')
    } catch {
      setMore('failed')
    }
  }

  const inviteAsk = (name: string | null): Ask =>
    name === null
      ? {
          title: words.inviteTitle,
          target: '',
          consequence: words.inviteBody,
          confirmLabel: words.next,
          input: { label: words.name, type: 'text', initial: '', placeholder: words.namePlaceholder, error: (v) => (v.trim() === '' ? words.nameMissing : null) },
          onConfirm: (_, value) => setAsk(inviteAsk((value ?? '').trim())),
        }
      : {
          title: fill(words.mobileTitle, { name }),
          target: name,
          consequence: words.mobileBody,
          confirmLabel: words.send,
          // A refusal leaves this dialog open with what was typed.
          stayOpen: true,
          error: null,
          input: { label: words.mobile, type: 'text', initial: '+', placeholder: words.mobilePlaceholder, error: (v) => (isMobile(v) ? null : words.mobileInvalid) },
          onConfirm: (_, value) => {
            const phone = toE164(value ?? '')
            setAsk((a) => a && { ...a, error: null })
            void run(
              async () => {
                await inviteRider(name, phone)
                setAsk(null)
                return fill(words.invited, { name, phone })
              },
              (text) => setAsk((a) => a && { ...a, error: text }),
            )
          },
        }

  const confirmed = (rider: Rider, what: 'suspend' | 'remove'): Ask => ({
    title: fill(what === 'suspend' ? words.suspendTitle : words.removeTitle, { name: rider.name }),
    target: rider.name,
    consequence: what === 'suspend' ? words.suspendBody : rider.status === 'invited' ? words.removeInvitedBody : words.removeBody,
    confirmLabel: what === 'suspend' ? words.suspend : words.remove,
    danger: true,
    onConfirm: () =>
      void run(async () => {
        if (what === 'suspend') await suspendRider(rider.id)
        else await removeRider(rider.id)
        return fill(what === 'suspend' ? words.suspended : words.removed, { name: rider.name })
      }),
  })

  /** The reason is kept in the activity log with the erasure. */
  const eraseAsk = (rider: Rider): Ask => ({
    title: fill(words.eraseTitle, { name: rider.name }),
    target: rider.name,
    consequence: words.eraseBody,
    confirmLabel: words.eraseConfirm,
    danger: true,
    input: { label: words.eraseReason, type: 'text', initial: '', placeholder: words.eraseReasonPlaceholder, error: (v) => (v.trim() === '' ? words.eraseReasonMissing : null) },
    onConfirm: (_, value) =>
      void run(async () => {
        await eraseRider(rider.id, (value ?? '').trim())
        return fill(words.erased, { name: rider.name })
      }),
  })

  const manage = (rider: Rider): Ask => {
    const sub = [words.statuses[rider.status], rider.phone].filter(Boolean).join(' · ')
    const options =
      rider.status === 'invited'
        ? [{ value: 'resend', label: words.resend }, { value: 'remove', label: words.cancelInvitation }]
        : [
            rider.status === 'suspended' ? { value: 'restore', label: words.restore } : { value: 'suspend', label: words.suspend },
            { value: 'remove', label: words.remove },
            { value: 'export', label: words.exportData },
            { value: 'erase', label: words.erase },
          ]
    return {
      title: rider.name,
      target: sub,
      consequence: '',
      confirmLabel: words.continue,
      choices: [{ key: 'what', label: words.whatNow, options, initial: options[0]?.value ?? 'remove', error: () => null }],
      onConfirm: (_, __, picks) => {
        const what = picks['what']
        if (what === 'resend') return void run(async () => (await resendRiderInvitation(rider.id), fill(words.resent, { name: rider.name })))
        if (what === 'restore') return void run(async () => (await restoreRider(rider.id), fill(words.restored, { name: rider.name })))
        if (what === 'export') return void run(async () => (await startListExport('riders', requestRiderExport(rider.id)), words.exportStarted))
        if (what === 'erase') return setAsk(eraseAsk(rider))
        setAsk(confirmed(rider, what === 'suspend' ? 'suspend' : 'remove'))
      },
    }
  }

  const shown = ask && (({ stayOpen, ...props }: Ask) => ({ stayOpen: stayOpen === true, props }))(ask)

  const inviteButton = (
    <button type="button" className="df-button df-button--primary" disabled={busy} onClick={() => setAsk(inviteAsk(null))}>
      {words.invite}
    </button>
  )

  return (
    <div className="df-team">
      <div className="df-team-head">
        <div>
          <h2>{words.title}</h2>
          <p>{words.sub}</p>
        </div>
        {canEdit && riders.length > 0 && inviteButton}
      </div>
      {riders.length === 0 ? (
        <div className="df-riders-empty">
          <h3>{words.emptyTitle}</h3>
          <p>{words.emptyBody}</p>
          {canEdit && inviteButton}
        </div>
      ) : (
        <div className="df-team-list">
          <div className="df-riders-head" aria-hidden="true">
            <span>{words.columns.rider}</span>
            <span>{words.columns.status}</span>
            <span>{words.columns.online}</span>
            <span>{words.columns.current}</span>
            <span>{words.columns.done}</span>
            <span />
          </div>
          <ul aria-label={words.title} className="df-riders-list">
            {riders.map((r) => (
              <li key={r.id} className="df-team-row df-riders-row">
                <span className="df-team-who">
                  <span className="df-team-mark" aria-hidden="true">
                    {initials(r.name) || '?'}
                  </span>
                  <span>
                    <strong>{r.name}</strong>
                    <span>{r.phone ?? ''}</span>
                  </span>
                </span>
                <span className={`df-team-status df-team-status--${tones[r.status]}`}>
                  <span className="df-visually-hidden">{words.columns.status}: </span>
                  {words.statuses[r.status]}
                </span>
                {r.status === 'active' ? (
                  <span className="df-riders-online" data-on={r.online}>
                    <span className="df-visually-hidden">{words.columns.online}: </span>
                    {r.online ? words.online : words.offline}
                  </span>
                ) : (
                  <span className="df-riders-quiet">{words.none}</span>
                )}
                <span className={r.currentDeliveryId ? undefined : 'df-riders-quiet'}>
                  <span className="df-visually-hidden">{words.columns.current}: </span>
                  {r.currentDeliveryId ? words.onDelivery : words.noDelivery}
                </span>
                <span className="df-riders-done">
                  <span className="df-visually-hidden">{words.columns.done}: </span>
                  {fill(words.delivered, { count: formatCount(r.deliveriesDone) })}
                </span>
                {canEdit ? (
                  <button type="button" className="df-riders-manage" disabled={busy} aria-haspopup="dialog" aria-label={fill(words.manage, { name: r.name })} onClick={() => setAsk(manage(r))}>
                    {words.manageShort}
                  </button>
                ) : (
                  <span />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {page.pageInfo.hasNextPage && (
        <div>
          <button type="button" className="df-button" disabled={more === 'busy'} onClick={() => void showMore()}>
            {words.showMore}
          </button>
          {more === 'failed' && (
            <p role="alert" className="df-team-foot">
              {words.moreFailed}
            </p>
          )}
        </div>
      )}
      {shown && (
        <ConfirmDialog
          key={`${shown.props.title}|${shown.props.target}|${shown.props.confirmLabel}`}
          {...shown.props}
          open
          cancelLabel={words.cancel}
          onCancel={() => setAsk(null)}
          onConfirm={(...args) => {
            if (!shown.stayOpen) setAsk(null)
            shown.props.onConfirm(...args)
          }}
        />
      )}
    </div>
  )
}
