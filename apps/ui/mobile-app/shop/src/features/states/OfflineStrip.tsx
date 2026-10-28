import type { ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { t } from '../../messages'
import { useOnline } from './connection'

/** The banner every screen shows while offline (shop/FIRST-RELEASE.md §1). It takes the status bar's inset, so the screens below get none; the tree never changes shape, so nothing typed is lost. */
export function OfflineStrip({ children }: { children: ReactNode }) {
  const online = useOnline()
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  return (
    <View style={styles.root}>
      {online ? null : (
        <View accessibilityRole="alert" style={[styles.strip, { paddingTop: insets.top + 10, backgroundColor: colors.heading }]}>
          <Text style={{ color: colors.page, fontSize: 13, lineHeight: 18 }}>{t('states.offline.strip')}</Text>
        </View>
      )}
      <SafeAreaInsetsContext.Provider value={online ? insets : { ...insets, top: 0 }}>
        <View style={styles.root}>{children}</View>
      </SafeAreaInsetsContext.Provider>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  strip: { paddingHorizontal: 16, paddingBottom: 10 },
})
