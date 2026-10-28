import { Image } from 'expo-image'
import { Linking, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { useShop } from '../../api/ShopContext'
import { t } from '../../messages'
import { Button } from '../common/ui'
import { useOrderHeaders } from '../orders/WithOrderAccess'
import type { TrackingRider } from './tracking'

const photoSize = 56

/** The photo to load, with the order's credentials only when it is on the store's own host; none for an address that is not a URL. */
export const photoSource = (photoUrl: string | null, host: string, headers: Record<string, string>): { uri: string; headers?: Record<string, string> } | null => {
  if (!photoUrl) return null
  const origin = `https://${host}`
  try {
    const url = new URL(photoUrl, origin)
    return { uri: url.toString(), ...(url.origin === origin ? { headers } : {}) }
  } catch {
    return null
  }
}

/** The rider while they have the order: first name, vehicle, a photo only the order's reader can load, and a call to their number. */
export function RiderCard({ rider }: { rider: TrackingRider }) {
  const { colors, radii } = useTheme()
  const { host } = useShop()
  const headers = useOrderHeaders()
  const source = photoSource(rider.photoUrl, host, headers)
  const phone = rider.phone
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.card }]}>
      <Text accessibilityRole="header" style={{ color: colors.muted, fontSize: 13, fontWeight: '700' }}>
        {t('tracking.rider')}
      </Text>
      <View style={styles.row}>
        {source ? (
          <Image accessibilityLabel={t('tracking.photo', { name: rider.name })} source={source} style={[styles.photo, { backgroundColor: colors.skeleton }]} contentFit="cover" />
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
