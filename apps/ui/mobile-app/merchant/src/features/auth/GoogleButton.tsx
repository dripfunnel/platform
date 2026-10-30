import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { SvgXml } from 'react-native-svg'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { t } from '../../messages'
import { googleMarkXml } from './googleMark'

// PortalAuth's "Continue with Google" and its "or with email" rule (designs/mobile-app/merchant/PortalAuth.dc.html, login):
// the secondary button's look, 50 px tall (DESIGN.md §4).
export function GoogleButton({ onPress, busy }: { onPress: () => void; busy: boolean }) {
  const { colors, radii } = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('auth.googleButton')}
      accessibilityState={{ disabled: busy, busy }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [styles.button, { borderRadius: radii.button, borderColor: colors.fieldBorder, backgroundColor: pressed ? colors.page : colors.surface }]}
    >
      {busy ? (
        <ActivityIndicator color={colors.text} />
      ) : (
        <>
          <SvgXml xml={googleMarkXml} width={18} height={18} />
          <Text style={[styles.label, { color: colors.text }]}>{t('auth.googleButton')}</Text>
        </>
      )}
    </Pressable>
  )
}

/** The rule between Google and the email fields, read past by a screen reader. */
export function OrWithEmail() {
  const { colors } = useTheme()
  return (
    <View style={styles.or} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[styles.rule, { backgroundColor: colors.border }]} />
      <Text style={[styles.orText, { color: colors.muted }]}>{t('auth.googleOr')}</Text>
      <View style={[styles.rule, { backgroundColor: colors.border }]} />
    </View>
  )
}

const styles = StyleSheet.create({
  button: { height: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, borderWidth: 1, paddingHorizontal: 16 },
  label: { fontSize: 16, fontWeight: '600' },
  or: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rule: { flex: 1, height: 1 },
  orText: { fontSize: 12 },
})
