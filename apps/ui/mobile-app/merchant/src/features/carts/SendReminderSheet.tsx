import { useState } from 'react'
import { handCodePercent, remindNow, type AbandonedCart } from '../../api/carts'
import type { ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { t } from '../../messages'
import { ChoiceRow } from '../common/ChoiceRow'
import { FormSheet } from '../settings/FormSheet'
import { nameOf } from './cartText'

type Props = { client: ApiClient; cart: AbandonedCart; codes: boolean; scheduled: boolean; onClose: () => void; onDone: () => void }

// "Send reminder now": by email at once, even in quiet hours. A single-use 10% code is offered only on the plan's `automatic`; below it the
// API sends one reminder a cart with no code (FIRST-RELEASE (store) §9), and a refusal stays here, worded by its code.
export function SendReminderSheet({ client, cart, codes, scheduled, onClose, onDone }: Props) {
  const [withCode, setWithCode] = useState(false)
  const email = cart.email ?? ''
  const percent = codes && withCode ? handCodePercent : null
  return (
    <FormSheet
      title={t('carts.act.sendTitle', { name: nameOf(cart) })}
      body={[t('carts.act.sendBody', { email }), scheduled ? t('carts.act.sendNext') : ''].filter(Boolean).join(' ')}
      confirm={t('carts.act.send')}
      context="carts"
      onClose={onClose}
      onSubmit={async () => {
        await remindNow(client, cart.id, percent)
        onDone()
        return t(percent ? 'carts.act.sentCode' : 'carts.act.sent', { email })
      }}
    >
      {codes ? (
        <>
          <ChoiceRow label={t('carts.act.noCode')} selected={!withCode} onPress={() => setWithCode(false)} />
          <ChoiceRow label={t('carts.act.tenOff')} selected={withCode} onPress={() => setWithCode(true)} />
        </>
      ) : null}
    </FormSheet>
  )
}
