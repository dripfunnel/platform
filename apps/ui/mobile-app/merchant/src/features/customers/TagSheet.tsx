import { useState } from 'react'
import { customerTagLimits, setCustomerTags, type Customer } from '../../api/customers'
import type { ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { t } from '../../messages'
import { TextField } from '../common/TextField'
import { FormSheet } from '../settings/FormSheet'

type Props = { client: ApiClient; customer: Customer; onClose: () => void; onDone: () => Promise<void> }

// "Add a tag": up to 24 characters, and a customer holds up to 20 (the API's limits, `customerTagLimits`).
export function TagSheet({ client, customer, onClose, onDone }: Props) {
  const [text, setText] = useState('')
  const tag = text.trim()
  return (
    <FormSheet
      title={t('customers.detail.tag.title')}
      body={t('customers.detail.tag.body')}
      confirm={t('customers.detail.tag.confirm')}
      context="customers"
      onClose={onClose}
      check={() => (tag === '' ? t('customers.detail.tag.missing') : tag.length > customerTagLimits.length ? t('customers.detail.tag.tooLong') : customer.tags.includes(tag) ? t('customers.detail.tag.duplicate') : null)}
      onSubmit={async () => {
        await setCustomerTags(client, customer.id, [...customer.tags, tag])
        await onDone()
        return t('customers.detail.tagAdded', { tag })
      }}
    >
      <TextField label={t('customers.detail.tag.label')} value={text} onChangeText={setText} placeholder={t('customers.detail.tag.placeholder')} autoCapitalize="sentences" />
    </FormSheet>
  )
}
