import { resumeReminders, type AbandonedCart } from '../../api/carts'
import type { ApiClient } from '../../graphql'
import { t } from '../../messages'
import { FormSheet } from '../settings/FormSheet'
import { nameOf } from './cartText'

type Props = { client: ApiClient; cart: AbandonedCart; onClose: () => void; onDone: () => void }

// "Resume reminders": the cart goes back to the schedule, which may send what was already due.
export function ResumeRemindersSheet({ client, cart, onClose, onDone }: Props) {
  return (
    <FormSheet
      title={t('carts.act.resumeTitle', { name: nameOf(cart) })}
      body={t('carts.act.resumeBody')}
      confirm={t('carts.act.resume')}
      context="carts"
      onClose={onClose}
      onSubmit={async () => {
        await resumeReminders(client, cart.id)
        onDone()
        return t('carts.act.resumed', { name: nameOf(cart) })
      }}
    />
  )
}
