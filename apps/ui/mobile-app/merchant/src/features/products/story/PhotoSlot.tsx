import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { assetPath, uploadPhoto } from '../../../api/products'
import { t } from '../../../messages'
import { errorMessage } from '../../../messages/errorMessage'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { Button } from '../../common/Button'
import { LinkButton } from '../../common/LinkButton'
import { TextField } from '../../common/TextField'
import { fileDeps } from '../files'
import { pickFromCamera, pickFromLibrary, type Picked } from '../pickPhoto'
import { ProductPhoto } from '../ProductPhoto'
import type { DraftStoryPhoto } from './storyDraft'

type Props = {
  photo: DraftStoryPhoto
  onChange: (photo: DraftStoryPhoto) => void
  label: string
  /** What the description field is called for a screen reader and on screen. */
  altLabel: string
  /** Whether a description is asked for (a module's photo is, a feature's optional photo is too, once it has one). */
  disabled: boolean
  /** Marked when publishing says this photo or its description is still to fill in. */
  marked?: boolean
}

// One photo of a module (CATALOG-DESIGN.md Q): taken or picked on the phone, uploaded as it comes, with the description a screen
// reader reads, which publishing asks for. A photo that fails to upload says why and can be tried again.
export function PhotoSlot({ photo, onChange, label, altLabel, disabled, marked = false }: Props) {
  const { colors } = useTheme()
  const [problem, setProblem] = useState<string | null>(null)
  const [denied, setDenied] = useState(false)

  const upload = async (file: Picked) => {
    setProblem(null)
    onChange({ assetId: null, alt: photo.alt, localUri: file.uri })
    try {
      const assetId = await uploadPhoto(fileDeps(), file)
      onChange({ assetId, alt: photo.alt, localUri: file.uri })
    } catch (error) {
      onChange({ assetId: null, alt: photo.alt, localUri: null })
      setProblem(errorMessage(error, 'products'))
    }
  }

  const choose = async () => {
    const [file] = await pickFromLibrary(1)
    if (file) await upload(file)
  }
  const take = async () => {
    const { files, denied: refused } = await pickFromCamera()
    setDenied(refused)
    if (files[0]) await upload(files[0])
  }

  const has = photo.assetId !== null || photo.localUri !== null
  return (
    <View style={styles.slot}>
      <Text style={[styles.label, { color: colors.text }]}>{label}</Text>
      {has ? (
        <View style={styles.row}>
          <ProductPhoto path={photo.assetId ? assetPath(photo.assetId) : null} localUri={photo.localUri} size={96} label={photo.alt || label} />
          {!disabled ? (
            <View style={styles.actions}>
              <LinkButton label={t('products.story.photoReplace')} onPress={() => void choose()} />
              <LinkButton danger label={t('products.story.photoRemove')} onPress={() => onChange({ assetId: null, alt: '', localUri: null })} />
            </View>
          ) : null}
        </View>
      ) : !disabled ? (
        <View style={styles.pick}>
          <Button kind="secondary" label={t('products.photos.take')} onPress={() => void take()} />
          <Button kind="secondary" label={t('products.photos.choose')} onPress={() => void choose()} />
        </View>
      ) : null}
      {has ? <TextField label={altLabel} help={t('products.story.altHint')} value={photo.alt} editable={!disabled} autoCapitalize="sentences" invalid={marked && photo.alt.trim() === ''} onChangeText={(alt) => onChange({ ...photo, alt })} /> : null}
      {problem ? <Text style={{ color: colors.danger, fontSize: 13 }}>{problem}</Text> : null}
      {denied ? <Text style={{ color: colors.danger, fontSize: 13 }}>{t('products.photos.cameraDenied')}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  slot: { gap: 8 },
  label: { fontSize: 14, fontWeight: '700' },
  row: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  actions: { flex: 1 },
  pick: { gap: 8 },
})
