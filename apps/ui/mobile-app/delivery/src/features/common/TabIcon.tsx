import { StyleSheet, View, type ColorValue } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { useTheme } from '@dripfunnel/mobile-shared/theme'

// The prototype's tab icons (designs/mobile-app/delivery-partner-app/DF Delivery App Prototype.dc.html, `TAB`), on a 24-px grid.
const paths = {
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  history: 'M3 12a9 9 0 1 0 3-6.7 M3 4v5h5 M12 7v5l3 2',
  profile: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21a8 8 0 0 1 16 0',
} as const

export type TabIconName = keyof typeof paths

/** The icon in its pill: the active tab's pill is tinted, as in the prototype. */
export function TabIcon({ name, color, focused }: { name: TabIconName; color: ColorValue; focused: boolean }) {
  const { colors } = useTheme()
  return (
    <View style={[styles.pill, focused ? { backgroundColor: `${colors.brand}33` } : null]}>
      <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Path d={paths[name]} stroke={color} strokeWidth={focused ? 2.1 : 1.7} strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    </View>
  )
}

const styles = StyleSheet.create({
  pill: { width: 56, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
})
