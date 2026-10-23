import { StyleSheet, Text, View } from 'react-native'
import type { Customer } from '../../api/customers'
import { t } from '../../messages'
import { tCount } from '../../messages/plural'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { Button } from '../common/Button'
import { addressText, defaultAddress, spentText } from './customerFacts'

type Props = { customer: Customer; canEdit: boolean; onEdit: () => void }

// Who they are: name, contact, default address, how many orders and what they've spent (the API's figure, Staff included, ACCESS.md §5.1).
export function CustomerHeader({ customer, canEdit, onEdit }: Props) {
  const { colors, radii } = useTheme()
  const address = defaultAddress(customer)
  const spent = spentText(customer.spent)
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.card }]}>
      <Text accessibilityRole="header" style={[styles.name, { color: colors.heading }]}>
        {customer.name ?? t('customers.row.noName')}
      </Text>
      <Text style={[styles.contact, { color: colors.textStrong }]}>
        {t('customers.detail.contact', { email: customer.email ?? t('customers.detail.noEmail'), phone: customer.phone ?? t('customers.detail.noPhone') })}
      </Text>
      <Text style={[styles.contact, { color: colors.textStrong }]}>{address ? addressText(address) : t('customers.detail.noAddress')}</Text>
      <View style={styles.facts}>
        <Text style={[styles.fact, { color: colors.info, backgroundColor: colors.infoSurface }]}>{tCount('customers.detail.orders', customer.ordersCount)}</Text>
        {spent ? <Text style={[styles.fact, { color: colors.success, backgroundColor: colors.successSurface }]}>{t('customers.detail.spent', { amount: spent })}</Text> : null}
      </View>
      {canEdit ? <Button saves kind="secondary" label={t('customers.detail.edit')} onPress={onEdit} /> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, padding: 16, gap: 10 },
  name: { fontSize: 22, fontWeight: '800' },
  contact: { fontSize: 14, lineHeight: 21 },
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  fact: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, fontSize: 13, overflow: 'hidden' },
})
