import { StyleSheet, Text, View } from 'react-native'
import { formatDistance, formatDuration, pluralForm } from '@dripfunnel/mobile-shared/format'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import type { Offer } from '../../api/dispatch'
import { locale, t } from '../../messages'
import { Button } from '../common/ui'

type Props = {
  offer: Offer
  now: number
  /** The offer another rider took first: it says so, and goes in a moment. */
  taken: boolean
  busy: boolean
  /** Why the last Accept did not work, in words. */
  refusal: string | null
  onAccept: () => void
  onDecline: () => void
}

/** Seconds left until the store's alert, never below 0. */
export const secondsLeft = (expiresAt: string, now: number): number => Math.max(0, Math.floor((Date.parse(expiresAt) - now) / 1000))

export function OfferCard({ offer, now, taken, busy, refusal, onAccept, onDecline }: Props) {
  const { colors, radii } = useTheme()
  const items = offer.itemCount ?? 0
  const itemsText = pluralForm(locale, { one: t('home.itemOne', { count: items }), other: t('home.itemOther', { count: items }) }, items)

  if (taken) {
    return (
      <View accessibilityRole="alert" style={[styles.card, { backgroundColor: colors.neutralSurface, borderColor: colors.border, borderRadius: radii.tile }]}>
        <Text style={{ color: colors.textStrong, fontSize: 14 }}>{t('home.taken')}</Text>
      </View>
    )
  }

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.tile }]}>
      <View style={styles.head}>
        <View style={styles.where}>
          <Text style={[styles.warehouse, { color: colors.heading }]}>{offer.warehouse}</Text>
          {offer.distanceM !== null ? <Text style={{ color: colors.textStrong, fontSize: 14 }}>{t('home.distanceAway', { distance: formatDistance(offer.distanceM, locale) })}</Text> : null}
        </View>
        <View style={[styles.left, { backgroundColor: colors.warningSurface }]}>
          <Text style={{ color: colors.warning, fontSize: 13, fontWeight: '600' }}>{t('home.timeLeft', { time: formatDuration(secondsLeft(offer.expiresAt, now), locale) })}</Text>
        </View>
      </View>
      <View style={styles.facts}>
        <View>
          <Text style={{ color: colors.muted, fontSize: 12 }}>{t('home.items')}</Text>
          <Text style={{ color: colors.text, fontWeight: '700' }}>{itemsText}</Text>
        </View>
        <View>
          <Text style={{ color: colors.muted, fontSize: 12 }}>{t('home.deliverTo')}</Text>
          <Text style={{ color: colors.text, fontWeight: '700' }}>{offer.area}</Text>
        </View>
      </View>
      {refusal ? (
        <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 13 }}>
          {refusal}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <View style={styles.decline}>
          <Button kind="secondary" label={t('home.decline')} disabled={busy} onPress={onDecline} />
        </View>
        <View style={styles.accept}>
          <Button label={t('home.accept')} busy={busy} onPress={onAccept} />
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, padding: 16, gap: 12 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 },
  where: { flex: 1, gap: 2 },
  warehouse: { fontSize: 17, fontWeight: '800' },
  left: { minHeight: 28, paddingHorizontal: 10, borderRadius: 14, justifyContent: 'center' },
  facts: { flexDirection: 'row', gap: 24 },
  actions: { flexDirection: 'row', gap: 8 },
  decline: { flex: 1 },
  accept: { flex: 1.4 },
})
