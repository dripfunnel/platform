import { sendTestReminder } from '../../api/carts'
import type { ApiClient } from '../../graphql'
import { t } from '../../messages'
import { FormSheet } from '../settings/FormSheet'

type Props = { client: ApiClient; position: number; onClose: () => void }

// "Send me a test" of one saved step: it goes to the person's own email only, never one typed in (#321), so the sheet asks for nothing.
export function TestReminderSheet({ client, position, onClose }: Props) {
  return (
    <FormSheet
      title={t('carts.reminders.testTitle', { n: position })}
      body={t('carts.reminders.testBody')}
      confirm={t('carts.reminders.testSend')}
      context="carts"
      onClose={onClose}
      onSubmit={async () => {
        await sendTestReminder(client, position)
        return t('carts.reminders.testSent')
      }}
    />
  )
}
