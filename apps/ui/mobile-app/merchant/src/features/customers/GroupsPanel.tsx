import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { CustomerGroup } from '../../api/customers'
import { t } from '../../messages'
import { tCount } from '../../messages/plural'
import { useTheme } from '../../theme'
import { Button } from '../common/Button'
import { useFeedback } from '../shell/Feedback'

type Props = {
  groups: readonly CustomerGroup[]
  canEdit: boolean
  onSee: (group: CustomerGroup) => void
  onAdd: () => void
  onEdit: (group: CustomerGroup) => void
  onDelete: (group: CustomerGroup) => void
}

// Customers, Groups (PortalOrders): each group with its members. A card opens "See people", and for a seat that edits also Edit and Delete.
export function GroupsPanel({ groups, canEdit, onSee, onAdd, onEdit, onDelete }: Props) {
  const { colors, radii } = useTheme()
  const feedback = useFeedback()

  const manage = (group: CustomerGroup) =>
    feedback.menu({
      title: group.name,
      items: [
        { key: 'see', label: t('customers.groups.seePeople'), onPress: () => onSee(group) },
        { key: 'edit', label: t('customers.groups.edit'), onPress: () => onEdit(group) },
        { key: 'delete', label: t('customers.groups.delete'), danger: true, onPress: () => onDelete(group) },
      ],
    })

  return (
    <View style={styles.panel}>
      <Text style={[styles.intro, { color: colors.muted }]}>{t('customers.groups.intro')}</Text>
      {canEdit ? <Button saves label={t('customers.groups.add')} onPress={onAdd} /> : null}
      {groups.length === 0 ? <Text style={[styles.intro, { color: colors.muted }]}>{t('customers.groups.none')}</Text> : null}
      {groups.map((group) => {
        const members = tCount('customers.groups.members', group.members)
        return (
          <Pressable
            key={group.id}
            accessibilityRole="button"
            accessibilityLabel={t(canEdit ? 'customers.groups.manage' : 'customers.groups.seeIn', { name: group.name })}
            onPress={() => (canEdit ? manage(group) : onSee(group))}
            style={({ pressed }) => [styles.card, { backgroundColor: pressed ? colors.hover : colors.surface, borderColor: colors.border, borderRadius: radii.card }]}
          >
            <View style={styles.text}>
              <Text style={[styles.name, { color: colors.text }]}>{group.name}</Text>
              <Text style={[styles.intro, { color: colors.muted }]}>{group.description ? t('customers.groups.membersWith', { members, description: group.description }) : members}</Text>
            </View>
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  panel: { gap: 12 },
  intro: { fontSize: 13, lineHeight: 19 },
  card: { minHeight: 64, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  text: { flex: 1, gap: 2 },
  name: { fontSize: 15, fontWeight: '700' },
})
