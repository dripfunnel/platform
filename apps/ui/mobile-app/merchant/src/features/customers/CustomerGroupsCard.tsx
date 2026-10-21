import { StyleSheet, Text, View } from 'react-native'
import { setCustomerGroups, type Customer, type CustomerGroup } from '../../api/customers'
import type { ApiClient } from '../../graphql'
import { t } from '../../messages'
import { useTheme } from '../../theme'
import { Chip } from '../common/Chip'
import { SectionCard } from '../common/SectionCard'
import type { CustomerWrite } from './customerWrite'

type Props = { client: ApiClient; customer: Customer; groups: readonly CustomerGroup[]; canEdit: boolean; write: CustomerWrite; refresh: () => Promise<void> }

// The groups, each a chip that puts them in or takes them out. Offers made for a group apply to them from then on.
export function CustomerGroupsCard({ client, customer, groups, canEdit, write, refresh }: Props) {
  const { colors } = useTheme()
  const name = customer.name ?? t('customers.row.noName')

  const toggle = (group: CustomerGroup) => {
    const on = customer.groupIds.includes(group.id)
    const next = on ? customer.groupIds.filter((id) => id !== group.id) : [...customer.groupIds, group.id]
    void write.run(async () => {
      await setCustomerGroups(client, customer.id, next)
      await refresh()
      return t(on ? 'customers.detail.leftGroup' : 'customers.detail.addedTo', { name, group: group.name })
    })
  }

  return (
    <SectionCard title={t('customers.detail.groups')}>
      {groups.length === 0 ? (
        <Text style={[styles.sub, { color: colors.muted }]}>{t('customers.detail.noGroups')}</Text>
      ) : (
        <View style={styles.chips}>
          {groups.map((group) => (
            <Chip key={group.id} label={group.name} accessibilityLabel={group.name} selected={customer.groupIds.includes(group.id)} disabled={!canEdit || write.busy} onPress={() => toggle(group)} />
          ))}
        </View>
      )}
    </SectionCard>
  )
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  sub: { fontSize: 13, lineHeight: 19 },
})
