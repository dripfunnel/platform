import { Pressable, StyleSheet, Text, View } from 'react-native'
import { customerTagLimits, setCustomerTags, type Customer } from '../../api/customers'
import type { ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { t } from '../../messages'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { Button } from '../common/Button'
import { SectionCard } from '../common/SectionCard'
import type { CustomerWrite } from './customerWrite'

type Props = { client: ApiClient; customer: Customer; canEdit: boolean; write: CustomerWrite; refresh: () => Promise<void>; onAdd: () => void }

// Tags to find people by: each can be removed, and "+ Tag" opens its sheet until a customer holds the most the API keeps.
export function CustomerTagsCard({ client, customer, canEdit, write, refresh, onAdd }: Props) {
  const { colors } = useTheme()
  const full = customer.tags.length >= customerTagLimits.count

  const remove = (tag: string) =>
    void write.run(async () => {
      await setCustomerTags(client, customer.id, customer.tags.filter((other) => other !== tag))
      await refresh()
      return t('customers.detail.tagRemoved', { tag })
    })

  return (
    <SectionCard title={t('customers.detail.tags')}>
      <View style={styles.chips}>
        {customer.tags.map((tag) =>
          canEdit ? (
            <Pressable
              key={tag}
              accessibilityRole="button"
              accessibilityLabel={t('customers.detail.removeTag', { tag })}
              disabled={write.busy}
              onPress={() => remove(tag)}
              style={[styles.tag, { backgroundColor: colors.neutralSurface, opacity: write.busy ? 0.6 : 1 }]}
            >
              <Text style={[styles.tagText, { color: colors.textStrong }]}>{`${tag}  ×`}</Text>
            </Pressable>
          ) : (
            <View key={tag} style={[styles.tag, { backgroundColor: colors.neutralSurface }]}>
              <Text style={[styles.tagText, { color: colors.textStrong }]}>{tag}</Text>
            </View>
          ),
        )}
      </View>
      {canEdit && !full ? <Button saves kind="secondary" label={t('customers.detail.addTag')} onPress={onAdd} /> : null}
      {canEdit && full ? <Text style={[styles.sub, { color: colors.muted }]}>{t('customers.detail.tagsFull')}</Text> : null}
    </SectionCard>
  )
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: { minHeight: 44, paddingHorizontal: 14, borderRadius: 22, justifyContent: 'center' },
  tagText: { fontSize: 14, fontWeight: '600' },
  sub: { fontSize: 13, lineHeight: 19 },
})
