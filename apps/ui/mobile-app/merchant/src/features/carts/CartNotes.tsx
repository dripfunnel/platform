import { t } from '../../messages'
import { Notice } from '../common/Notice'
import type { CartsAccess } from './access'
import type { ReminderSending } from '../../api/carts'

// What a seat should know before reading carts: a read-only store, Staff's view-only access, and how reminders go on this plan.
export function CartNotes({ access, sending }: { access: CartsAccess; sending: ReminderSending | null }) {
  return (
    <>
      {access.readOnly ? <Notice text={t('carts.readOnly')} /> : null}
      {access.viewOnly ? <Notice text={t('carts.viewOnly')} /> : null}
      {access.canEdit && sending?.level === 'youSend' ? <Notice text={t('carts.youSend')} /> : null}
      {access.canEdit && sending && sending.level !== 'youSend' && !sending.enabled ? <Notice text={t('carts.off')} /> : null}
    </>
  )
}
