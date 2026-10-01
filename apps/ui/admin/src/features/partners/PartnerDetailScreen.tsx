import { getRouteApi, Link, useRouter, useRouterState } from '@tanstack/react-router'
import { useCallback, useState } from 'react'
import { partnerActions, recheckDomain, runPartnerAction, type Partner, type PartnerAction, type PartnerDomain } from '../../api/partners'
import { fill, messages } from '../../messages'
import { actionCodes } from '../../api/activityActions'
import { ActivityTab } from '../common/ActivityTab'
import { ConfirmDialog } from '../common/ConfirmDialog'
import { callerFor } from '../common/harnessCaller'
import { useScreenState } from '../common/useScreenState'
import { actionDialog, actionToast, type ConfirmedAction } from './actionDialog'
import { partnerStates } from './partnerHarness'
import { PartnerDetail, PartnerError } from './PartnerDetail'
import { Toast } from '../common/Toast'
import { useImpersonateFrom } from '../impersonate/useImpersonateFrom'

const partnerRoute = getRouteApi('/_app/partners_/$partnerId')
const shellRoute = getRouteApi('/_app')

// ?state=confirm opens the first action this partner offers, so its dialog can be checked.
const firstAllowed = (partner: Partner | null): ConfirmedAction | null =>
  partnerActions.filter((action): action is ConfirmedAction => action !== 'setupSession').find((action) => partner?.actions[action]?.allowed) ?? null

export const PartnerDetailScreen = () => {
  const partner = partnerRoute.useLoaderData()
  const { tab = 'overview', after, before, ...activityFilter } = partnerRoute.useSearch()
  const { me } = shellRoute.useLoaderData()
  const searchStr = useRouterState({ select: (state) => state.location.searchStr })
  const navigate = partnerRoute.useNavigate()
  const forced = useScreenState(partnerStates)
  const router = useRouter()
  const [pending, setPending] = useState<ConfirmedAction | null>(() => (forced === 'confirm' ? firstAllowed(partner) : null))
  const [toast, setToast] = useState<string | null>(null)
  const clearToast = useCallback(() => setToast(null), [])

  const caller = callerFor(me.role, searchStr)
  const sessions = useImpersonateFrom(caller, me.name)
  // A setup session asks its own questions and signs in again (ACCESS.md §8.2), so it has its own flow.
  const onAction = (action: PartnerAction) =>
    action === 'setupSession' ? partner && sessions.start({ kind: 'setup', partner: { id: partner.id, name: partner.name } }) : setPending(action)

  const onConfirm = (action: ConfirmedAction, target: Partner, reason: string | null) => {
    setPending(null)
    runPartnerAction(target.id, action, reason)
      .then(() => {
        setToast(actionToast(action, target))
        return router.invalidate()
      })
      .catch(() => setToast(messages.partner.toasts.failed))
  }

  const onRecheck = (domain: PartnerDomain) =>
    partner
      ? recheckDomain(partner.id, domain.kind)
          .then((status) => setToast(fill(messages.partner.domains.rechecked[status], { host: domain.host })))
          .catch(() => setToast(messages.partner.toasts.failed))
      : Promise.resolve()

  const dialog = partner && pending ? actionDialog(pending, partner) : null

  return (
    <>
      <PartnerDetail
        partner={partner}
        tab={tab}
        forced={forced}
        readOnly={me.role === 'staff-read-only' || forced === 'readonly'}
        onAction={onAction}
        onRecheck={onRecheck}
        onImpersonate={sessions.impersonate}
        onReload={() => void router.invalidate()}
        activity={
          partner && (
            <ActivityTab
              scope={{ partner: partner.id }}
              filter={activityFilter}
              page={{ after, before }}
              caller={caller}
              actions={actionCodes}
              onFilterChange={(filter) => void navigate({ search: { tab: 'activity', ...filter }, replace: true })}
              pageLink={(cursor, label) => (
                <Link to="/partners/$partnerId" params={{ partnerId: partner.id }} search={{ tab: 'activity', ...activityFilter, ...cursor }} className="df-button">
                  {label}
                </Link>
              )}
            />
          )
        }
      />
      {partner && (
        <ConfirmDialog
          open={dialog !== null}
          title={dialog?.title ?? ''}
          target={dialog?.target ?? ''}
          consequence={dialog?.consequence ?? ''}
          confirmLabel={dialog?.confirmLabel ?? ''}
          cancelLabel={messages.partner.cancel}
          {...(dialog?.notes ? { notes: dialog.notes } : {})}
          {...(dialog?.reason ? { reason: dialog.reason } : {})}
          danger={dialog?.danger ?? false}
          onConfirm={(reason) => pending && onConfirm(pending, partner, reason)}
          onCancel={() => setPending(null)}
        />
      )}
      <Toast message={toast} onDone={clearToast} />
      {sessions.element}
    </>
  )
}

export const PartnerRouteError = () => {
  const router = useRouter()
  return <PartnerError onRetry={() => void router.invalidate()} />
}
