import { useState } from 'react'
import { maxStopNote, stopReminders, type AbandonedCart } from '../../api/carts'
import type { ApiClient } from '../../graphql'
import { t } from '../../messages'
import { TextArea } from '../common/TextArea'
import { FormSheet } from '../settings/FormSheet'
import { nameOf } from './cartText'

type Props = { client: ApiClient; cart: AbandonedCart; onClose: () => void; onDone: () => void }

// "Stop reminders": no more go out for this cart, with the team's note (at most the API's 200 characters) kept on it.
export function StopRemindersSheet({ client, cart, onClose, onDone }: Props) {
  const [note, setNote] = useState('')
  return (
    <FormSheet
      danger
      title={t('carts.act.stopTitle', { name: nameOf(cart) })}
      body={t('carts.act.stopBody')}
      confirm={t('carts.act.stop')}
      context="carts"
      onClose={onClose}
      check={() => (note.trim().length > maxStopNote ? t('carts.act.noteLong', { max: maxStopNote }) : null)}
      onSubmit={async () => {
        await stopReminders(client, cart.id, note.trim() || null)
        onDone()
        return t('carts.act.stopped', { name: nameOf(cart) })
      }}
    >
      <TextArea label={t('carts.act.noteLabel')} value={note} onChangeText={setNote} placeholder={t('carts.act.notePlaceholder')} lines={3} />
    </FormSheet>
  )
}
