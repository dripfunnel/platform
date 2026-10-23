import { useState } from 'react'
import { createGroup, renameGroup, type CustomerGroup } from '../../api/customers'
import type { ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { t } from '../../messages'
import { TextField } from '../common/TextField'
import { FormSheet } from '../settings/FormSheet'

type Props = { client: ApiClient; group: CustomerGroup | null; onClose: () => void; onDone: () => void }

// Makes a group, or renames one (`group` null is a new one); a name already taken is refused by the API and stays in the sheet.
export function GroupNameSheet({ client, group, onClose, onDone }: Props) {
  const [name, setName] = useState(group?.name ?? '')
  return (
    <FormSheet
      title={group ? t('customers.groups.editTitle', { name: group.name }) : t('customers.groups.newTitle')}
      body={t('customers.groups.body')}
      confirm={group ? t('customers.groups.save') : t('customers.groups.make')}
      context="customers"
      onClose={onClose}
      check={() => (name.trim() === '' ? t('customers.groups.nameMissing') : null)}
      onSubmit={async () => {
        const typed = name.trim()
        if (group) await renameGroup(client, group, typed)
        else await createGroup(client, typed)
        onDone()
        return group ? t('customers.groups.saved') : t('customers.groups.made', { name: typed })
      }}
    >
      <TextField label={t('customers.groups.nameLabel')} value={name} onChangeText={setName} placeholder={t('customers.groups.namePlaceholder')} autoCapitalize="sentences" maxLength={80} />
    </FormSheet>
  )
}
