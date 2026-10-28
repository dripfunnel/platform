import { StyleSheet, View } from 'react-native'
import MapView, { Marker } from 'react-native-maps'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { t } from '../../messages'
import type { Pin } from './navigate'

const closeUp = 0.005

/** The customer's pin, still: the rider moves with their own map app (Navigate), not this one. */
export function DeliveryMap({ pin }: { pin: Pin }) {
  const { colors, radii } = useTheme()
  const region = { ...pin, latitudeDelta: closeUp, longitudeDelta: closeUp }
  return (
    <View style={[styles.box, { borderColor: colors.border, borderTopLeftRadius: radii.card, borderTopRightRadius: radii.card }]}>
      <MapView accessibilityLabel={t('delivery.mapLabel')} style={StyleSheet.absoluteFill} initialRegion={region} scrollEnabled={false} zoomEnabled={false} rotateEnabled={false} pitchEnabled={false} toolbarEnabled={false}>
        <Marker coordinate={pin} />
      </MapView>
    </View>
  )
}

const styles = StyleSheet.create({ box: { height: 140, overflow: 'hidden', borderBottomWidth: 1 } })
