import Constants from 'expo-constants'
import { useFocusEffect, useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { useBrand } from '@dripfunnel/mobile-shared/brand'
import { isApiError } from '@dripfunnel/mobile-shared/graphql'
import { deleteMyAccount } from '../../api/rider'
import { errorText, t } from '../../messages'
import { useSession } from '../../session/SessionContext'
import { Button, Loading, Refusal, StateMessage, TextButton } from '../common/ui'
import { useAction } from '../common/useAction'
import { useLoad } from '../common/useLoad'

const initials = (name: string): string =>
  name
    .trim()
    .split(/\s+/)
    .map((word) => word[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?'

type Asking = 'none' | 'delete' | 'parcel'

// The rider's own profile: edit, sign out, and delete my account (Apple 5.1.1(v); docs/api/DELIVERY.md §5).
export function ProfileScreen() {
  const router = useRouter()
  const { colors, radii } = useTheme()
  const { brand } = useBrand()
  const { client, fetchRider, signOut, leave } = useSession()
  const { state, reload } = useLoad(fetchRider)
  const out = useAction()
  const erase = useAction()
  const [asking, setAsking] = useState<Asking>('none')

  useFocusEffect(useCallback(() => reload(), [reload]))

  const signOutNow = () => void out.run(signOut)

  const eraseNow = async () => {
    const done = await erase.run(() =>
      deleteMyAccount(client).catch((error: unknown) => {
        if (isApiError(error, 'RIDER_HAS_PARCEL')) setAsking('parcel')
        throw error
      }),
    )
    if (done) await leave()
  }

  if (state.status === 'loading') return <Loading />
  if (state.status === 'offline') return <StateMessage title={t('states.offline.title')} body={t('states.offline.body')} actionLabel={t('common.retry')} onAction={reload} />
  if (state.status === 'error') return <StateMessage title={t('states.error.title')} body={errorText(state.code)} actionLabel={t('common.retry')} onAction={reload} />
  const rider = state.data
  const vehicle = rider.vehicleType ? [t(`profile.vehicles.${rider.vehicleType}`), rider.vehicleNumber].filter(Boolean).join(' · ') : t('profile.noVehicle')
  const version = [brand?.name, t('signIn.delivery'), t('profile.version', { version: Constants.expoConfig?.version ?? '' })].filter(Boolean).join(' · ')

  return (
    <ScrollView style={{ backgroundColor: colors.page }} contentContainerStyle={styles.body}>
      <View style={styles.who}>
        <View style={[styles.avatar, { backgroundColor: colors.selected }]}>
          <Text style={[styles.initials, { color: colors.link }]}>{initials(rider.name ?? '')}</Text>
        </View>
        <View style={styles.lines}>
          <Text accessibilityRole="header" style={[styles.name, { color: colors.heading }]}>
            {rider.name}
          </Text>
          {rider.phone ? <Text style={{ color: colors.textStrong }}>{rider.phone}</Text> : null}
          <Text style={{ color: colors.textStrong }}>{vehicle}</Text>
        </View>
      </View>

      <View style={[styles.list, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.tile }]}>
        <Pressable accessibilityRole="button" onPress={() => router.push('/profile-edit')} style={styles.row}>
          <Text style={{ color: colors.text, fontWeight: '600', fontSize: 15 }}>{t('profile.edit')}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityState={{ busy: out.busy }} disabled={out.busy} onPress={signOutNow} style={[styles.row, { borderTopWidth: 1, borderColor: colors.border }]}>
          <Text style={{ color: colors.text, fontWeight: '600', fontSize: 15 }}>{t('profile.signOut')}</Text>
        </Pressable>
      </View>
      <Refusal message={out.error ? errorText(out.error, 'signOut') : null} />

      <TextButton label={t('profile.deleteAccount')} tone="danger" onPress={() => setAsking('delete')} />
      <Text style={{ color: colors.muted, fontSize: 12 }}>{version}</Text>

      <Modal transparent animationType="fade" visible={asking !== 'none'} onRequestClose={() => setAsking('none')}>
        <View style={[styles.backdrop, { backgroundColor: colors.backdrop }]}>
          <View accessibilityViewIsModal style={[styles.sheet, { backgroundColor: colors.surface, borderTopLeftRadius: radii.sheet, borderTopRightRadius: radii.sheet }]}>
            {asking === 'parcel' ? (
              <>
                <Text accessibilityRole="header" style={[styles.sheetTitle, { color: colors.heading }]}>
                  {t('profile.delete.refusedTitle')}
                </Text>
                <Text style={{ color: colors.textStrong }}>{t('profile.delete.refusedBody')}</Text>
                <Button
                  label={t('profile.delete.toDelivery')}
                  onPress={() => {
                    setAsking('none')
                    router.push('/home')
                  }}
                />
                <Button kind="secondary" label={t('profile.delete.close')} onPress={() => setAsking('none')} />
              </>
            ) : (
              <>
                <Text accessibilityRole="header" style={[styles.sheetTitle, { color: colors.heading }]}>
                  {t('profile.delete.title')}
                </Text>
                <Text style={{ color: colors.textStrong }}>{t('profile.delete.body')}</Text>
                <Refusal message={erase.error && erase.error !== 'RIDER_HAS_PARCEL' ? errorText(erase.error, 'deleteAccount') : null} />
                <Button kind="danger" label={t('profile.delete.confirm')} busy={erase.busy} onPress={() => void eraseNow()} />
                <Button kind="secondary" label={t('profile.delete.keep')} disabled={erase.busy} onPress={() => setAsking('none')} />
              </>
            )}
          </View>
        </View>
      </Modal>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  body: { gap: 18, padding: 16, paddingTop: 56 },
  who: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  initials: { fontSize: 24, fontWeight: '800' },
  lines: { flex: 1, gap: 2 },
  name: { fontSize: 20, fontWeight: '800' },
  list: { borderWidth: 1, overflow: 'hidden' },
  row: { minHeight: 56, paddingHorizontal: 16, justifyContent: 'center' },
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: { gap: 14, padding: 20, paddingBottom: 32 },
  sheetTitle: { fontSize: 18, fontWeight: '800' },
})
