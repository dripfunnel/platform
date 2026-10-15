import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import type { CustomerGroup } from '../../api/customers'
import { formatNumber } from '../../format'
import { locale, t } from '../../messages'
import { useTheme } from '../../theme'
import { Chip } from '../common/Chip'

type Props = {
  search: string
  onSearch: (search: string) => void
  groups: readonly CustomerGroup[]
  groupId: string | null
  onGroup: (groupId: string | null) => void
}

// Search by name, email or tag, and the groups as chips, each with how many are in it (FIRST-RELEASE (store) §7).
export function CustomersFilters({ search, onSearch, groups, groupId, onGroup }: Props) {
  const { colors, radii } = useTheme()
  return (
    <View style={styles.block}>
      <View style={[styles.search, { borderColor: colors.fieldBorder, backgroundColor: colors.surface, borderRadius: radii.button }]}>
        <TextInput
          accessibilityLabel={t('customers.search.label')}
          value={search}
          onChangeText={onSearch}
          placeholder={t('customers.search.placeholder')}
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          style={[styles.input, { color: colors.text }]}
        />
        {search ? (
          <Pressable accessibilityRole="button" accessibilityLabel={t('customers.search.clear')} onPress={() => onSearch('')} style={styles.clear}>
            <Text style={{ color: colors.muted, fontSize: 18 }}>×</Text>
          </Pressable>
        ) : null}
      </View>
      {groups.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityLabel={t('customers.chips.label')}>
          <Chip label={t('customers.chips.everyone')} selected={groupId === null} onPress={() => onGroup(null)} />
          {groups.map((group) => (
            <Chip key={group.id} label={group.name} hint={formatNumber(group.members, locale)} accessibilityLabel={t('customers.chips.group', { name: group.name, count: formatNumber(group.members, locale) })} selected={groupId === group.id} onPress={() => onGroup(group.id)} />
          ))}
        </ScrollView>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  block: { gap: 10 },
  search: { minHeight: 44, flexDirection: 'row', alignItems: 'center', borderWidth: 1, paddingLeft: 12 },
  input: { flex: 1, fontSize: 15, minHeight: 44 },
  clear: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  chips: { gap: 6, paddingRight: 8 },
})
