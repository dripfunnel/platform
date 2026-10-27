import { Tabs } from 'expo-router'
import { t } from '../../messages'
import { useTheme } from '@dripfunnel/mobile-shared/theme'

// delivery/ARCHITECTURE.md §2: Home, History and Profile; each tab's file under (tabs).
const tabs = [
  { route: 'home', title: t('tabs.home') },
  { route: 'history', title: t('tabs.history') },
  { route: 'profile', title: t('tabs.profile') },
] as const

export default function TabsLayout() {
  const { colors } = useTheme()
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: colors.brand, tabBarStyle: { backgroundColor: colors.page } }}>
      {tabs.map(({ route, title }) => (
        <Tabs.Screen key={route} name={route} options={{ title }} />
      ))}
    </Tabs>
  )
}
