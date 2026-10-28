import { Image } from 'expo-image'
import { StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../theme'
import { useBrand } from './BrandContext'

export type BrandMarkLabels = { logo: (name: string) => string; logoUnnamed: string }

// The store's logo and name, whichever of them it has answered with; each app passes its own wording.
export function BrandMark({ labels }: { labels: BrandMarkLabels }) {
  const { brand } = useBrand()
  const { colors } = useTheme()
  if (!brand) return null
  return (
    <View style={styles.mark}>
      {brand.logo ? <Image source={{ uri: brand.logo }} accessibilityLabel={brand.name ? labels.logo(brand.name) : labels.logoUnnamed} contentFit="contain" style={styles.logo} /> : null}
      {brand.name ? <Text style={[styles.name, { color: colors.heading }]}>{brand.name}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  mark: { alignItems: 'center', gap: 8 },
  logo: { width: 160, height: 48 },
  name: { fontSize: 22, fontWeight: '700' },
})
