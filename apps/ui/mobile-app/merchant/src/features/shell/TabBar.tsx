import type { Tabs } from 'expo-router'
import type { ComponentProps } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { formatNumber } from '../../format'
import { locale, t, type MessageKey } from '../../messages'
import { tabsFor, type Tab } from '../../nav'
import { useTheme } from '../../theme'
import { hasIcon, Icon } from './Icon'
import { useShell, type Shell } from './ShellData'

// expo-router doesn't export the tab bar's props, so they are read off `Tabs`.
type BottomTabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0]

// A tab's route is its folder or file under (tabs): `orders/index` and `more/[item]` both belong to a tab.
const baseOf = (routeName: string): string => routeName.split('/')[0] ?? routeName

const countOf = (tab: Tab, badges: Shell['badges']): number => (tab.badge && badges ? badges[tab.badge] : 0)

// The tabs come from nav.ts for the role and tier (DESIGN.md §2); a route the role has no tab for is simply not drawn.
export function TabBar({ state, navigation }: BottomTabBarProps) {
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  const { seat, badges } = useShell()
  const tabs = tabsFor(seat)
  const active = baseOf(state.routes[state.index]?.name ?? '')

  return (
    <View accessibilityRole="tablist" style={[styles.bar, { backgroundColor: colors.surface, borderTopColor: colors.border, paddingBottom: insets.bottom + 6 }]}>
      {tabs.map((tab) => {
        const selected = active === tab.route
        const count = countOf(tab, badges)
        const label = t(`tabs.${tab.key}` as MessageKey)
        return (
          <Pressable
            key={tab.key}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={count > 0 ? t('shell.tabWithBadge', { tab: label, count: formatNumber(count, locale) }) : label}
            onPress={() => {
              const route = state.routes.find((r) => baseOf(r.name) === tab.route)
              if (route && !selected) navigation.navigate(route.name)
            }}
            style={styles.tab}
          >
            <View style={[styles.pill, { backgroundColor: selected ? colors.selected : 'transparent' }]}>
              {hasIcon(tab.key) ? <Icon name={tab.key} color={selected ? colors.heading : colors.muted} strokeWidth={selected ? 2 : 1.7} /> : null}
              {count > 0 ? (
                <View style={[styles.badge, { backgroundColor: colors.brand, borderColor: colors.surface }]}>
                  <Text style={[styles.badgeText, { color: colors.brandContrast }]}>{formatNumber(count, locale)}</Text>
                </View>
              ) : null}
            </View>
            <Text style={[styles.label, { color: selected ? colors.heading : colors.muted, fontWeight: selected ? '800' : '600' }]}>{label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', borderTopWidth: 1, paddingTop: 6, paddingHorizontal: 6 },
  tab: { flex: 1, minWidth: 0, height: 54, alignItems: 'center', gap: 3, paddingTop: 2 },
  pill: { width: 56, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: -3, right: 6, minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  badgeText: { fontSize: 11, fontWeight: '800' },
  label: { fontSize: 11 },
})
