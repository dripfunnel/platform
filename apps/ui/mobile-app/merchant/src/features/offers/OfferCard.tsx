import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { Offer } from '../../api/offers'
import { formatNumber } from '@dripfunnel/mobile-shared/format'
import { locale, t } from '../../messages'
import { tCount } from '../../messages/plural'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { StatusChip } from '../products/StatusChip'
import { regionWords, statusKeyOf, statusTone, timeLine, whatText, type OfferNames } from './offerView'

type Props = { offer: Offer; now: Date; timeZone: string; country: string | null; names: OfferNames; onOpen: () => void; onMore: () => void }

// An offer as a stacked card (DESIGN.md §4; Offers' phone cards, B9): its status and time line, name, what it gives, its code or how it
// applies, and its uses with a meter when it has a limit. "⋯" opens the row's actions. Every rule and figure is the API's.
export function OfferCard({ offer, now, timeZone, country, names, onOpen, onMore }: Props) {
  const { colors, radii } = useTheme()
  const key = statusKeyOf(offer, now)
  const uses = offer.totalUsesLimit ? t('offers.row.usesOf', { used: formatNumber(offer.usesCount, locale), total: formatNumber(offer.totalUsesLimit, locale) }) : tCount('offers.row.uses', offer.usesCount)
  const meter = offer.totalUsesLimit ? Math.min(100, Math.round((offer.usesCount / offer.totalUsesLimit) * 100)) : null
  const how = offer.code ?? (offer.trigger === 'code' ? t('offers.row.singleUse') : t('offers.row.automatic'))
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.card }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('offers.row.open', { name: offer.name })} onPress={onOpen} style={styles.body}>
        <View style={styles.top}>
          <StatusChip label={t(`offers.status.${key}`)} tone={statusTone[key]} />
          <Text numberOfLines={2} style={[styles.sub, styles.line, { color: colors.muted }]}>
            {timeLine(offer, now, timeZone)}
          </Text>
        </View>
        <Text style={[styles.name, { color: colors.text }]}>{offer.name}</Text>
        <Text style={[styles.sub, { color: colors.muted }]}>{whatText(offer, regionWords(country), names)}</Text>
        <View style={styles.foot}>
          <Text style={[styles.code, { color: colors.textStrong }, offer.code ? styles.mono : null]}>{how}</Text>
          <Text style={[styles.sub, { color: colors.muted }]}>{uses}</Text>
        </View>
        {meter !== null ? (
          <View accessibilityElementsHidden style={[styles.track, { backgroundColor: colors.neutralSurface }]}>
            <View style={[styles.fill, { width: `${meter}%`, backgroundColor: meter >= 100 ? colors.warning : colors.success }]} />
          </View>
        ) : null}
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={t('offers.row.actions', { name: offer.name })} onPress={onMore} style={styles.more}>
        <Text style={[styles.dots, { color: colors.muted }]}>⋯</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, flexDirection: 'row', alignItems: 'flex-start', minHeight: 96 },
  body: { flex: 1, padding: 14, gap: 6 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  line: { flex: 1 },
  name: { fontSize: 15, fontWeight: '700' },
  sub: { fontSize: 13, lineHeight: 18 },
  foot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  code: { fontSize: 13, fontWeight: '700' },
  mono: { fontFamily: 'monospace' },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  more: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  dots: { fontSize: 22, fontWeight: '800' },
})
