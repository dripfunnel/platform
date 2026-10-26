import * as Location from 'expo-location'
import { useRef, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import MapView, { Marker, type Region } from 'react-native-maps'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import type { Pin } from '../../api/account'
import { t } from '../../messages'
import { Button } from '../common/ui'

const worldView: Region = { latitude: 20, longitude: 0, latitudeDelta: 100, longitudeDelta: 100 }
const closeUp = 0.005

/**
 * The address's map pin, native (Google Maps on Android, Apple Maps on iOS): drop it, drag it, tap the map to move it, or take it
 * from the phone's location, asked for only while the app is in use and only when the shopper taps for it.
 */
export function PinMap({ pin, onChange, error }: { pin: Pin | null; onChange: (pin: Pin) => void; error?: string | null }) {
  const { colors, radii } = useTheme()
  const map = useRef<MapView>(null)
  const centre = useRef<Pin>({ latitude: worldView.latitude, longitude: worldView.longitude })
  const [locating, setLocating] = useState(false)
  const [refused, setRefused] = useState<'denied' | 'failed' | null>(null)

  const show = (at: Pin) => map.current?.animateToRegion({ ...at, latitudeDelta: closeUp, longitudeDelta: closeUp }, 400)

  const useMyLocation = async () => {
    setRefused(null)
    setLocating(true)
    try {
      const { granted } = await Location.requestForegroundPermissionsAsync()
      if (!granted) {
        setRefused('denied')
        return
      }
      const { coords } = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
      const at = { latitude: coords.latitude, longitude: coords.longitude }
      onChange(at)
      show(at)
    } catch {
      setRefused('failed')
    } finally {
      setLocating(false)
    }
  }

  return (
    <View style={[styles.box, { backgroundColor: colors.surface, borderColor: error ? colors.danger : colors.border, borderRadius: radii.card }]}>
      <View accessible accessibilityLabel={pin ? t('address.map.withPin') : t('address.map.noPin')} style={styles.map}>
        <MapView
          ref={map}
          style={StyleSheet.absoluteFill}
          initialRegion={pin ? { ...pin, latitudeDelta: closeUp, longitudeDelta: closeUp } : worldView}
          onRegionChangeComplete={(region) => {
            centre.current = { latitude: region.latitude, longitude: region.longitude }
          }}
          onPress={(event) => onChange(event.nativeEvent.coordinate)}
          toolbarEnabled={false}
        >
          {pin ? <Marker coordinate={pin} draggable onDragEnd={(event) => onChange(event.nativeEvent.coordinate)} /> : null}
        </MapView>
        {pin ? null : (
          <View style={styles.drop}>
            <Button label={t('address.map.drop')} onPress={() => onChange(centre.current)} />
          </View>
        )}
      </View>
      <View style={styles.help}>
        <Text style={{ color: colors.textStrong, fontSize: 14 }}>{t('address.map.help')}</Text>
        <Button kind="secondary" label={t('address.map.useLocation')} busy={locating} onPress={() => void useMyLocation()} />
        {refused ? (
          <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 13 }}>
            {t(refused === 'denied' ? 'address.map.denied' : 'address.map.failed')}
          </Text>
        ) : null}
      </View>
      {error ? (
        <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 13, fontWeight: '600', paddingHorizontal: 14, paddingBottom: 12 }}>
          {error}
        </Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, overflow: 'hidden' },
  map: { height: 220 },
  drop: { position: 'absolute', left: 12, right: 12, bottom: 12 },
  help: { gap: 8, padding: 14 },
})
