import { recordMarketingStop, type Customer } from '../../api/customers'
import type { ApiClient } from '../../graphql'
import { t } from '../../messages'
import { FormSheet } from '../settings/FormSheet'

type Props = { client: ApiClient; customer: Customer; onClose: () => void; onDone: () => Promise<void> }

// "Record that they asked to stop": only the shopper opts in, so the team can only record a stop, and order and delivery emails still go.
export function StopMarketingSheet({ client, customer, onClose, onDone }: Props) {
  const name = customer.name ?? t('customers.row.noName')
  return (
    <FormSheet
      title={t('customers.detail.consent.stopTitle', { name })}
      body={t('customers.detail.consent.stopBody')}
      confirm={t('customers.detail.consent.stopConfirm')}
      context="customers"
      onClose={onClose}
      onSubmit={async () => {
        await recordMarketingStop(client, customer.id)
        await onDone()
        return t('customers.detail.consent.stopDone', { name })
      }}
    />
  )
}
