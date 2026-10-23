import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { assetPath, uploadPhoto } from '../../../api/products'
import { t } from '../../../messages'
import { errorMessage } from '../../../messages/errorMessage'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { Button } from '../../common/Button'
import { fileDeps } from '../../products/files'
import { pickFromLibrary } from '../../products/pickPhoto'
import { ProductPhoto } from '../../products/ProductPhoto'

type Props = { label: string; help: string; empty: string; assetId: string | null; onChange: (assetId: string | null) => void; editable: boolean; removable: boolean; required?: boolean }

// The brand's logo and favicon: one picture from the phone's library, kept by the API as an asset (the same upload as a product photo).
export function ImageField({ label, help, empty, assetId, onChange, editable, removable, required = false }: Props) {
  const { colors } = useTheme()
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const choose = async () => {
    setBusy(true)
    setProblem(null)
    try {
      const [picked] = await pickFromLibrary(1)
      if (picked) onChange(await uploadPhoto(fileDeps(), picked))
    } catch (error) {
      setProblem(errorMessage(error, 'products'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.text }]}>
        {label}
        {required ? <Text style={[styles.required, { color: colors.muted }]}> {t('storefront.brand.required')}</Text> : null}
      </Text>
      <View style={styles.row}>
        <ProductPhoto path={assetId ? assetPath(assetId) : null} size={64} label={label} radius={12} showEmpty={false} />
        <Text style={[styles.state, { color: colors.muted }]}>{assetId ? t('storefront.brand.imageSet') : empty}</Text>
      </View>
      {editable ? (
        <View style={styles.buttons}>
          <View style={styles.button}>
            <Button kind="secondary" label={busy ? t('storefront.brand.uploading') : assetId ? t('storefront.brand.replace') : t('storefront.brand.upload')} busy={busy} saves onPress={() => void choose()} />
          </View>
          {removable && assetId ? (
            <View style={styles.button}>
              <Button kind="secondary" label={t('storefront.brand.removeImage')} disabled={busy} onPress={() => onChange(null)} />
            </View>
          ) : null}
        </View>
      ) : null}
      <Text style={[styles.help, { color: problem ? colors.danger : colors.muted }]}>{problem ?? help}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  field: { gap: 8 },
  label: { fontSize: 14, fontWeight: '700' },
  required: { fontWeight: '400' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  state: { flex: 1, fontSize: 14 },
  buttons: { flexDirection: 'row', gap: 8 },
  button: { flex: 1 },
  help: { fontSize: 13, lineHeight: 18 },
})
