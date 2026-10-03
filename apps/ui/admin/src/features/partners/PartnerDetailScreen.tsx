import { getRouteApi, Link, useRouter, useRouterState } from '@tanstack/react-router'
import { useCallback, useState } from 'react'
import { partnerActions, recheckDomain, runPartnerAction, type Partner, type PartnerAction, type PartnerDomain } from '../../api/partners'
import { fill, messages } from '../../messages'
import { actionCodes } from '../../api/activityActions'
import { ActivityTab } from '../common/ActivityTab'
import { EmptyState, ConfirmDialog, useScreenState, Toast } from '@dripfunnel/shared/ui'
import { harnessEnabled } from '../../harness'
import { failureText } from '../common/failure'
import { callerFor } from '../common/harnessCaller'
import { RouteError } from '../common/RouteError'
import { actionDialog, actionToast, type ConfirmedAction } from './actionDialog'
import { deniedPartner, partnerStates } from './partnerHarness'
import { PartnerDetail, PartnerError } from './PartnerDetail'
import { useImpersonateFrom } from '../impersonate/useImpersonateFrom'

const partnerRoute = getRouteApi('/_app/partners_/$partnerId')
const shellRoute = getRouteApi('/_app')

// ?state=confirm opens the first action this partner offers, so its dialog can be checked.
const firstAllowed = (partner: Partner | null): ConfirmedAction | null =>
  partnerActions.filter((action): action is ConfirmedAction => action !== 'setupSession').find((action) => partner?.actions[action]?.allowed) ?? null

export const PartnerDetailScreen = () => {
  const loaded = partnerRoute.useLoaderData()
  const { tab = 'overview', after, before, ...activityFilter } = partnerRoute.useSearch()
  const { me } = shellRoute.useLoaderData()
  const searchStr = useRouterState({ select: (state) => state.location.searchStr })
  const navigate = partnerRoute.useNavigate()
  const forced = useScreenState(partnerStates, harnessEnabled)
  const partner = loaded && forced === 'denied' ? deniedPartner(loaded) : loaded
  const router = useRouter()
  const [pending, setPending] = useState<ConfirmedAction | null>(() => (forced === 'confirm' ? firstAllowed(partner) : null))
  const [toast, setToast] = useState<string | null>(null)
  const clearToast = useCallback(() => setToast(null), [])

  // The activity tab and the session flows still read the sample as this caller (#39, #40).
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
      .catch((error: unknown) => setToast(failureText(error, messages.partner.toasts.failed)))
  }

  const onRecheck = (domain: PartnerDomain) =>
    partner
      ? recheckDomain(partner.id, domain.kind)
          .then(() => setToast(fill(messages.partner.domains.recheckQueued, { host: domain.host })))
          .catch((error: unknown) => setToast(failureText(error, messages.partner.toasts.failed)))
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
        onImpersonate={(id) => partner && sessions.impersonate(id, { email: partner.team.find((person) => person.id === id)?.email ?? '', partner: partner.id })}
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

// A partner outside a Partner manager's assignment is refused by the API (ACCESS.md §5.4).
const PartnerDenied = () => {
  const words = messages.partners.denied
  return (
    <div className="df-page df-list">
      <EmptyState
        title={words.title}
        body={words.body}
        action={
          <Link to="/partners" className="df-button">
            {words.back}
          </Link>
        }
      />
    </div>
  )
}

export const PartnerRouteError = ({ error }: { error: unknown }) => {
  const router = useRouter()
  return <RouteError error={error} view={(details) => <PartnerError onRetry={() => void router.invalidate()} details={details} />} denied={<PartnerDenied />} />
}
