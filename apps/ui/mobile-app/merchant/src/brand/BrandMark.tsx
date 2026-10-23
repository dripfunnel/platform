import { Image } from 'expo-image'
import { StyleSheet, Text, View } from 'react-native'
import { t } from '../messages'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { useBrand } from './BrandProvider'

// The partner's logo and name; DripFunnel's name alone until the partner has answered with a look.
export function BrandMark() {
  const { brand, domain } = useBrand()
  const { colors, mode } = useTheme()
  const name = brand?.productName ?? t('brand.defaultName')
  const path = mode === 'dark' ? (brand?.files.logoDark ?? brand?.files.logoLight) : brand?.files.logoLight
  return (
    <View style={styles.mark}>
      {path ? <Image source={{ uri: `https://${domain}${path}` }} accessibilityLabel={t('brand.logo', { name })} contentFit="contain" style={styles.logo} /> : null}
      <Text style={[styles.name, { color: colors.heading }]}>{name}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  mark: { alignItems: 'center', gap: 8 },
  logo: { width: 160, height: 48 },
  name: { fontSize: 22, fontWeight: '700' },
})
