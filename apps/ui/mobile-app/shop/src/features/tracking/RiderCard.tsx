import { Image } from 'expo-image'
import { Linking, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { useShop } from '../../api/ShopContext'
import { t } from '../../messages'
import { Button } from '../common/ui'
import { useOrderHeaders } from '../orders/WithOrderAccess'
import type { TrackingRider } from './tracking'

const photoSize = 56

/** The rider while they have the order: first name, vehicle, a photo only the order's reader can load, and a call to their number. */
export function RiderCard({ rider }: { rider: TrackingRider }) {
  const { colors, radii } = useTheme()
  const { host } = useShop()
  const headers = useOrderHeaders()
  const photo = rider.photoUrl ? new URL(rider.photoUrl, `https://${host}`).toString() : null
  const phone = rider.phone
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.card }]}>
      <Text accessibilityRole="header" style={{ color: colors.muted, fontSize: 13, fontWeight: '700' }}>
        {t('tracking.rider')}
      </Text>
      <View style={styles.row}>
        {photo ? (
          <Image accessibilityLabel={t('tracking.photo', { name: rider.name })} source={{ uri: photo, headers }} style={[styles.photo, { backgroundColor: colors.skeleton }]} contentFit="cover" />
        ) : (
          <View accessible={false} style={[styles.photo, styles.initial, { backgroundColor: colors.neutralSurface }]}>
            <Text style={{ color: colors.neutral, fontSize: 22, fontWeight: '800' }}>{rider.name.slice(0, 1)}</Text>
          </View>
        )}
        <View style={styles.who}>
          <Text style={{ color: colors.heading, fontSize: 18, fontWeight: '800' }}>{rider.name}</Text>
          {rider.vehicle ? <Text style={{ color: colors.textStrong, fontSize: 14 }}>{rider.vehicle}</Text> : null}
        </View>
      </View>
      {phone ? <Button label={t('tracking.call', { name: rider.name })} onPress={() => void Linking.openURL(`tel:${phone}`).catch(() => undefined)} /> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { gap: 10, padding: 14, borderWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  photo: { width: photoSize, height: photoSize, borderRadius: photoSize / 2 },
  initial: { alignItems: 'center', justifyContent: 'center' },
  who: { flex: 1, gap: 2 },
})
