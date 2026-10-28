import { useEffect, useRef } from 'react'
import { StyleSheet, View } from 'react-native'
import MapView, { Marker } from 'react-native-maps'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { t } from '../../messages'

const closeUp = 0.01

/** Where the rider is, moving as each answer brings a new position. The API gives no address pin for an order (shop/ARCHITECTURE.md §4). */
export function LiveMap({ position, name }: { position: { latitude: number; longitude: number }; name: string }) {
  const { colors, radii } = useTheme()
  const map = useRef<MapView>(null)
  const { latitude, longitude } = position

  useEffect(() => {
    map.current?.animateToRegion({ latitude, longitude, latitudeDelta: closeUp, longitudeDelta: closeUp }, 400)
  }, [latitude, longitude])

  return (
    <View style={[styles.box, { borderColor: colors.border, borderRadius: radii.card }]}>
      <MapView
        ref={map}
        accessibilityLabel={t('tracking.map.label', { name })}
        style={StyleSheet.absoluteFill}
        initialRegion={{ latitude, longitude, latitudeDelta: closeUp, longitudeDelta: closeUp }}
        toolbarEnabled={false}
        rotateEnabled={false}
      >
        <Marker coordinate={{ latitude, longitude }} title={name} />
      </MapView>
    </View>
  )
}

const styles = StyleSheet.create({ box: { height: 240, overflow: 'hidden', borderWidth: 1 } })
