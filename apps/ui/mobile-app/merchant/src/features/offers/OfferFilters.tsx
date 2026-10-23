import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { offerKinds, offerTabs, type Offer, type OfferCounts, type OfferKind, type OfferTab } from '../../api/offers'
import { formatNumber } from '@dripfunnel/mobile-shared/format'
import { locale, t } from '../../messages'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { Chip } from '../common/Chip'
import type { RegionWords } from './offerView'

type Props = {
  tab: OfferTab
  onTab: (tab: OfferTab) => void
  counts: OfferCounts | null
  search: string
  onSearch: (search: string) => void
  kind: OfferKind | null
  onKind: (kind: OfferKind | null) => void
  trigger: Offer['trigger'] | null
  onTrigger: (trigger: Offer['trigger'] | null) => void
  region: RegionWords
}

// The four tabs with the API's counts, search by name or code, and the two filters (OFFERS-DESIGN B1, B3, B4).
export function OfferFilters({ tab, onTab, counts, search, onSearch, kind, onKind, trigger, onTrigger, region }: Props) {
  const { colors, radii } = useTheme()
  return (
    <View style={styles.block}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityLabel={t('offers.tabs.label')}>
        {offerTabs.map((key) => (
          <Chip
            key={key}
            label={t(`offers.tabs.${key}`)}
            hint={counts ? formatNumber(counts[key], locale) : undefined}
            {...(counts ? { accessibilityLabel: t('offers.tabs.counted', { tab: t(`offers.tabs.${key}`), count: formatNumber(counts[key], locale) }) } : {})}
            selected={key === tab}
            onPress={() => onTab(key)}
          />
        ))}
      </ScrollView>
      <View style={[styles.search, { borderColor: colors.fieldBorder, backgroundColor: colors.surface, borderRadius: radii.button }]}>
        <TextInput
          accessibilityLabel={t('offers.search.label')}
          value={search}
          onChangeText={onSearch}
          placeholder={t('offers.search.placeholder')}
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          style={[styles.input, { color: colors.text }]}
        />
        {search ? (
          <Pressable accessibilityRole="button" accessibilityLabel={t('offers.search.clear')} onPress={() => onSearch('')} style={styles.clear}>
            <Text style={{ color: colors.muted, fontSize: 18 }}>×</Text>
          </Pressable>
        ) : null}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityLabel={t('offers.filters.type')}>
        <Chip label={t('offers.filters.allTypes')} selected={kind === null} onPress={() => onKind(null)} />
        {offerKinds.map((key) => (
          <Chip key={key} label={t(`offers.kinds.${key}`, { ship: region.ship })} selected={kind === key} onPress={() => onKind(key)} />
        ))}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityLabel={t('offers.filters.how')}>
        <Chip label={t('offers.filters.allHow')} selected={trigger === null} onPress={() => onTrigger(null)} />
        <Chip label={t('offers.filters.automatic')} selected={trigger === 'automatic'} onPress={() => onTrigger('automatic')} />
        <Chip label={t('offers.filters.code')} selected={trigger === 'code'} onPress={() => onTrigger('code')} />
      </ScrollView>
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
