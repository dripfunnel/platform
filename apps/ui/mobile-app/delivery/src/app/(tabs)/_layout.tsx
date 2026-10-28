import { Tabs } from 'expo-router'
import { t } from '../../messages'
import { TabIcon, type TabIconName } from '../../features/common/TabIcon'
import { useTheme } from '@dripfunnel/mobile-shared/theme'

// delivery/ARCHITECTURE.md §2: Home, History and Profile; each tab's file under (tabs).
const tabs: readonly { route: TabIconName; title: string }[] = [
  { route: 'home', title: t('tabs.home') },
  { route: 'history', title: t('tabs.history') },
  { route: 'profile', title: t('tabs.profile') },
]

export default function TabsLayout() {
  const { colors } = useTheme()
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: colors.link, tabBarInactiveTintColor: colors.muted, tabBarStyle: { backgroundColor: colors.surface } }}>
      {tabs.map(({ route, title }) => (
        <Tabs.Screen key={route} name={route} options={{ title, tabBarIcon: ({ color, focused }) => <TabIcon name={route} color={color} focused={focused} /> }} />
      ))}
    </Tabs>
  )
}
