import { deleteGroup, type CustomerGroup } from '../../api/customers'
import type { ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { t } from '../../messages'
import { tCount } from '../../messages/plural'
import { FormSheet } from '../settings/FormSheet'

type Props = { client: ApiClient; group: CustomerGroup; onClose: () => void; onDone: () => void }

// Says who leaves and what stops applying before it deletes anything (the card's Prompt); the customers stay.
export function DeleteGroupSheet({ client, group, onClose, onDone }: Props) {
  return (
    <FormSheet
      title={t('customers.groups.deleteTitle', { name: group.name })}
      body={group.members === 0 ? t('customers.groups.deleteEmpty', { name: group.name }) : tCount('customers.groups.deleteBody', group.members, { name: group.name })}
      confirm={t('customers.groups.deleteConfirm')}
      danger
      context="customers"
      onClose={onClose}
      onSubmit={async () => {
        await deleteGroup(client, group.id)
        onDone()
        return t('customers.groups.deleted', { name: group.name })
      }}
    />
  )
}
