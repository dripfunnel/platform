import { StyleSheet, Text, View } from 'react-native'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import type { BannerSpec } from './bannerSpecs'
import { SupportAskBar } from './SupportAskBar'

// Banners sit between the header and the screen, a bold title with the explanation after it. They carry no button
// (plans and billing aren't in the app, FIRST-RELEASE.md §1) except support's Allow and Deny.
export function Banners({ banners }: { banners: readonly BannerSpec[] }) {
  const { colors } = useTheme()
  return (
    <>
      {banners.map((banner) => {
        const palette = {
          info: { bg: colors.infoSurface, border: colors.infoBorder, fg: colors.info },
          warning: { bg: colors.warningSurface, border: colors.warningBorder, fg: colors.warning },
          danger: { bg: colors.dangerSurface, border: colors.dangerBorder, fg: colors.danger },
          success: { bg: colors.successSurface, border: colors.successBorder, fg: colors.success },
          offline: { bg: colors.neutralSurface, border: colors.neutralBorder, fg: colors.neutral },
        }[banner.tone]
        return (
          <View key={banner.key} accessibilityRole="alert" accessibilityLiveRegion="polite" style={[styles.banner, { backgroundColor: palette.bg, borderBottomColor: palette.border }]}>
            <Text style={[styles.text, { color: palette.fg }]}>
              <Text style={styles.title}>{banner.title}</Text> {banner.body}
            </Text>
            {banner.ask ? <SupportAskBar ask={banner.ask} color={palette.fg} /> : null}
          </View>
        )
      })}
    </>
  )
}

const styles = StyleSheet.create({
  banner: { paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1 },
  text: { fontSize: 12, lineHeight: 17 },
  title: { fontWeight: '700' },
})
