import { useRouter } from 'expo-router'
import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import type { Customer, CustomerGroup } from '../../api/customers'
import type { ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { t } from '../../messages'
import { Notice } from '../common/Notice'
import { useWrite } from '../settings/useWrite'
import type { CustomersAccess } from './access'
import { CustomerConsentCard } from './CustomerConsentCard'
import { CustomerGroupsCard } from './CustomerGroupsCard'
import { CustomerHeader } from './CustomerHeader'
import { CustomerNoteCard } from './CustomerNoteCard'
import { CustomerOrdersCard } from './CustomerOrdersCard'
import { CustomerTagsCard } from './CustomerTagsCard'
import { EditCustomerSheet } from './EditCustomerSheet'
import { orderHref } from './routes'
import { StopMarketingSheet } from './StopMarketingSheet'
import { TagSheet } from './TagSheet'

type Props = { client: ApiClient; customer: Customer; groups: readonly CustomerGroup[]; timeZone: string; access: CustomersAccess; refresh: () => Promise<void> }
type Sheet = 'edit' | 'tag' | 'stop'

// One customer (PortalOrders, Customers; FIRST-RELEASE (store) §7): contact, groups, tags, the team's note, marketing consent and their newest
// orders. Each change is its own write, said in a toast; a refusal shows above, in words by its code.
export function CustomerView({ client, customer, groups, timeZone, access, refresh }: Props) {
  const router = useRouter()
  const write = useWrite('customers')
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const close = () => setSheet(null)
  const { canEdit } = access

  return (
    <View style={styles.content}>
      {access.readOnly ? <Notice text={t('customers.readOnly')} /> : null}
      {write.failure ? <Notice kind="error" text={write.failure} /> : null}
      <CustomerHeader customer={customer} canEdit={canEdit} onEdit={() => setSheet('edit')} />
      <CustomerGroupsCard client={client} customer={customer} groups={groups} canEdit={canEdit} write={write} refresh={refresh} />
      <CustomerTagsCard client={client} customer={customer} canEdit={canEdit} write={write} refresh={refresh} onAdd={() => setSheet('tag')} />
      <CustomerNoteCard client={client} customer={customer} canEdit={canEdit} write={write} refresh={refresh} />
      <CustomerConsentCard customer={customer} timeZone={timeZone} canEdit={canEdit} onStop={() => setSheet('stop')} />
      <CustomerOrdersCard customer={customer} timeZone={timeZone} onOpen={(id) => router.push(orderHref(id) as never)} />
      {sheet === 'edit' ? <EditCustomerSheet client={client} customer={customer} onClose={close} onDone={refresh} /> : null}
      {sheet === 'tag' ? <TagSheet client={client} customer={customer} onClose={close} onDone={refresh} /> : null}
      {sheet === 'stop' ? <StopMarketingSheet client={client} customer={customer} onClose={close} onDone={refresh} /> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  content: { padding: 14, gap: 14, paddingBottom: 32 },
})
