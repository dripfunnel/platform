import { Image } from 'expo-image'
import { StyleSheet, Text, View } from 'react-native'
import { assetSource } from '../../api/products'
import { t } from '../../messages'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { fileDeps } from './files'

type Props = { path: string | null; localUri?: string | null; size: number; label: string; radius?: number; showEmpty?: boolean }

// A product photo read through the session (the API's paths are relative and private to the store), or the phone's own file
// while it uploads; a product with no photo is a quiet box that says so (CATALOG-DESIGN.md F8).
export function ProductPhoto({ path, localUri = null, size, label, radius = 8, showEmpty = true }: Props) {
  const { colors } = useTheme()
  const source = localUri ? { uri: localUri } : path ? assetSource(fileDeps(), path) : null
  return (
    <View style={[styles.box, { width: size, height: size, borderRadius: radius, borderColor: colors.border, backgroundColor: colors.page }]}>
      {source ? (
        <Image source={source} accessibilityLabel={label} contentFit="cover" style={{ width: size, height: size }} />
      ) : showEmpty ? (
        <Text style={[styles.empty, { color: colors.muted }]}>{t('products.row.noPhoto')}</Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  empty: { fontSize: 10, textAlign: 'center' },
})
