import { StyleSheet, Text, View } from 'react-native'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import type { RiderDelivery } from '../../api/delivery'
import { t } from '../../messages'
import { Button } from '../common/ui'
import { navigateTo } from './navigate'

/** How a delivery ended for the rider: done and sent, done and saved without signal, or the store will confirm it. */
export function ResultCard({ tone, title, body, onBack }: { tone: 'success' | 'warning'; title: string; body: string; onBack: () => void }) {
  const { colors, radii } = useTheme()
  const surface = tone === 'success' ? [colors.successSurface, colors.successBorder, colors.success] : [colors.warningSurface, colors.warningBorder, colors.warning]
  return (
    <View accessibilityRole="alert" style={[styles.result, { backgroundColor: surface[0], borderColor: surface[1], borderRadius: radii.card }]}>
      <Text accessibilityRole="header" style={{ color: surface[2], fontSize: 22, fontWeight: '700' }}>
        {title}
      </Text>
      {body ? <Text style={{ color: surface[2], fontSize: 15 }}>{body}</Text> : null}
      <Button label={t('delivery.result.back')} onPress={onBack} />
    </View>
  )
}

/** The parcel goes back to the warehouse: after Not delivered, or when the store recalled it. */
export function ReturnCard({ note, saved, title, delivery, onBack }: { note: string; saved: string | null; title: string; delivery: RiderDelivery; onBack: () => void }) {
  const { colors, radii } = useTheme()
  const pin = delivery.warehouse && delivery.warehouse.latitude !== null && delivery.warehouse.longitude !== null ? { latitude: delivery.warehouse.latitude, longitude: delivery.warehouse.longitude } : null
  return (
    <View style={[styles.result, { backgroundColor: colors.infoSurface, borderColor: colors.infoBorder, borderRadius: radii.card }]}>
      <Text style={{ color: colors.info, fontSize: 14 }}>{note}</Text>
      <Text accessibilityRole="header" style={{ color: colors.info, fontSize: 20, fontWeight: '700' }}>
        {title}
      </Text>
      {saved ? <Text style={{ color: colors.warning, fontWeight: '700' }}>{saved}</Text> : null}
      <Text style={{ color: colors.text }}>{t('delivery.returnParcel.body')}</Text>
      {pin ? <Button label={t('delivery.navigate')} onPress={() => void navigateTo(pin, delivery.warehouse?.name ?? '')} /> : null}
      <Button kind="secondary" label={t('delivery.returnParcel.backHome')} onPress={onBack} />
    </View>
  )
}

const styles = StyleSheet.create({ result: { borderWidth: 1, padding: 20, gap: 12 } })
