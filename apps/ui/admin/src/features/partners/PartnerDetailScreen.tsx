import { getRouteApi, useRouter } from '@tanstack/react-router'
import { useCallback, useState } from 'react'
import { partnerActions, recheckDomain, runPartnerAction, type Partner, type PartnerAction, type PartnerDomain } from '../../api/partners'
import { fill, messages } from '../../messages'
import { ConfirmDialog } from '../common/ConfirmDialog'
import { useScreenState } from '../common/useScreenState'
import { actionDialog, actionToast } from './actionDialog'
import { partnerStates } from './partnerHarness'
import { PartnerDetail, PartnerError } from './PartnerDetail'
import { Toast } from './Toast'

const partnerRoute = getRouteApi('/_app/partners_/$partnerId')
const shellRoute = getRouteApi('/_app')

// ?state=confirm opens the first action this partner offers, so its dialog can be checked.
const firstAllowed = (partner: Partner | null): PartnerAction | null =>
  partnerActions.find((action) => partner?.actions[action]?.allowed) ?? null

export const PartnerDetailScreen = () => {
  const partner = partnerRoute.useLoaderData()
  const { tab = 'overview' } = partnerRoute.useSearch()
  const { me } = shellRoute.useLoaderData()
  const forced = useScreenState(partnerStates)
  const router = useRouter()
  const [pending, setPending] = useState<PartnerAction | null>(() => (forced === 'confirm' ? firstAllowed(partner) : null))
  const [toast, setToast] = useState<string | null>(null)
  const clearToast = useCallback(() => setToast(null), [])

  const onConfirm = (action: PartnerAction, target: Partner, reason: string | null) => {
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
        onAction={setPending}
        onRecheck={onRecheck}
        onReload={() => void router.invalidate()}
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
    </>
  )
}

export const PartnerRouteError = () => {
  const router = useRouter()
  return <PartnerError onRetry={() => void router.invalidate()} />
}
