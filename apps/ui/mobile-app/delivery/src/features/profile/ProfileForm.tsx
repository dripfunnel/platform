import { Image } from 'expo-image'
import { useState } from 'react'
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { updateProfile, vehicleTypes, type Rider, type VehicleType } from '../../api/rider'
import { errorText, t } from '../../messages'
import { useSession } from '../../session/SessionContext'
import { Button, Field, Refusal, ScreenHeader, TextButton } from '../common/ui'
import { useAction } from '../common/useAction'
import { initials } from './initials'
import { pickPhoto, type PhotoSource } from './pickPhoto'

const withoutNumber: readonly VehicleType[] = ['bicycle', 'foot']

type Props = {
  rider: Rider
  /** `first`: the setup after the first sign-in, which has no way back. `edit`: the Profile's edit screen. */
  mode: 'first' | 'edit'
  storeName: string | null
  onSaved: () => void
  onBack?: () => void
}

// Name, photo, vehicle type and number, saved together (docs/api/DELIVERY.md §5).
export function ProfileForm({ rider, mode, storeName, onSaved, onBack }: Props) {
  const { colors } = useTheme()
  const { client, uploadPhoto } = useSession()
  const save = useAction()
  const upload = useAction()
  const [name, setName] = useState(rider.name ?? '')
  const [vehicleType, setVehicleType] = useState<VehicleType | null>(rider.vehicleType)
  const [vehicleNumber, setVehicleNumber] = useState(rider.vehicleNumber ?? '')
  const [photoAssetId, setPhotoAssetId] = useState(rider.photoAssetId)
  const [preview, setPreview] = useState<string | null>(null)
  const [choosing, setChoosing] = useState(false)
  const [cameraDenied, setCameraDenied] = useState(false)
  const [problems, setProblems] = useState<{ name?: boolean; vehicle?: boolean }>({})
  const first = mode === 'first'
  const hasPhoto = photoAssetId !== null

  const choose = async (source: PhotoSource) => {
    setChoosing(false)
    setCameraDenied(false)
    const picked = await pickPhoto(source)
    if (picked === 'denied') return setCameraDenied(true)
    if (!picked) return
    const done = await upload.run(() => uploadPhoto(picked.uri, picked.mimeType))
    if (done) {
      setPhotoAssetId(done.value)
      setPreview(picked.uri)
    }
  }

  const submit = async () => {
    const found = { name: !name.trim(), vehicle: vehicleType === null }
    setProblems(found)
    if (found.name || vehicleType === null) return
    const number = withoutNumber.includes(vehicleType) ? null : vehicleNumber.trim() || null
    const done = await save.run(() => updateProfile(client, { name: name.trim(), photoAssetId, vehicleType, vehicleNumber: number }))
    if (done) onSaved()
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.page }]}>
      <ScreenHeader title={first ? t('profile.setupTitle') : t('profile.editTitle')} {...(onBack ? { onBack } : {})} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
        {first ? <Text style={{ color: colors.textStrong }}>{storeName ? t('profile.setupBody', { name: storeName }) : t('profile.setupBodyUnnamed')}</Text> : null}

        <View style={styles.photoRow}>
          <View style={[styles.avatar, { backgroundColor: colors.selected }]}>
            {preview ? <Image source={{ uri: preview }} accessibilityLabel={t('profile.photo.of')} style={styles.avatarImage} /> : <Text style={[styles.initials, { color: colors.link }]}>{initials(name)}</Text>}
          </View>
          <Button kind="secondary" label={hasPhoto ? t('profile.photo.change') : t('profile.photo.add')} busy={upload.busy} onPress={() => setChoosing(!choosing)} />
        </View>
        {choosing ? (
          <View style={styles.choices}>
            <Button kind="secondary" label={t('profile.photo.camera')} onPress={() => void choose('camera')} />
            <Button kind="secondary" label={t('profile.photo.library')} onPress={() => void choose('library')} />
          </View>
        ) : null}
        {hasPhoto && !preview ? <Text style={{ color: colors.muted, fontSize: 13 }}>{t('profile.photo.saved')}</Text> : null}
        {upload.busy ? (
          <Text accessibilityRole="alert" style={{ color: colors.muted, fontSize: 13 }}>
            {t('profile.photo.uploading')}
          </Text>
        ) : null}
        {cameraDenied ? (
          <View accessibilityRole="alert" style={styles.denied}>
            <Text style={{ color: colors.text, fontSize: 14 }}>{t('profile.photo.cameraDenied')}</Text>
            <TextButton label={t('profile.photo.openSettings')} onPress={() => void Linking.openSettings()} />
          </View>
        ) : null}
        <Refusal message={upload.error ? errorText(upload.error, 'photo') : null} />

        <Field label={t('profile.name')} value={name} onChangeText={setName} error={problems.name ? t('profile.nameRequired') : null} autoComplete="name" textContentType="name" maxLength={120} />

        <View style={styles.group}>
          <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>{t('profile.vehicle')}</Text>
          <View accessibilityRole="radiogroup" accessibilityLabel={t('profile.vehicle')} style={styles.chips}>
            {vehicleTypes.map((type) => {
              const on = vehicleType === type
              return (
                <Pressable
                  key={type}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  onPress={() => setVehicleType(type)}
                  style={[styles.chip, { borderColor: on ? colors.link : colors.fieldBorder, backgroundColor: on ? colors.selected : colors.surface }]}
                >
                  <Text style={{ color: colors.text, fontWeight: '600', fontSize: 14 }}>{t(`profile.vehicles.${type}`)}</Text>
                </Pressable>
              )
            })}
          </View>
          {problems.vehicle ? (
            <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 13, fontWeight: '600' }}>
              {t('profile.vehicleRequired')}
            </Text>
          ) : null}
        </View>

        {vehicleType && !withoutNumber.includes(vehicleType) ? (
          <Field label={t('profile.vehicleNumber')} value={vehicleNumber} onChangeText={(value) => setVehicleNumber(value.toUpperCase())} autoCapitalize="characters" maxLength={20} hint={t('profile.vehicleNumberHint')} />
        ) : null}

        <Refusal message={save.error ? errorText(save.error, 'profile') : null} />
      </ScrollView>
      <View style={[styles.footer, { borderColor: colors.border, backgroundColor: colors.surface }]}>
        <Button label={first ? t('profile.continue') : t('profile.save')} busy={save.busy} disabled={upload.busy} onPress={() => void submit()} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { gap: 18, padding: 18 },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarImage: { width: 72, height: 72 },
  initials: { fontSize: 24, fontWeight: '800' },
  choices: { gap: 8 },
  denied: { gap: 4 },
  group: { gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 44, paddingHorizontal: 16, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  footer: { padding: 18, paddingBottom: 26, borderTopWidth: 1 },
})
