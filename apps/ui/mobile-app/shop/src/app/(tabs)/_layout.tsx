import { Tabs } from 'expo-router'
import { t } from '../../messages'
import { useTheme } from '@dripfunnel/mobile-shared/theme'

// shop/ARCHITECTURE.md §2: Home, Browse, Cart and Account; each tab's folder or file under (tabs).
const routes = ['home', 'browse', 'cart', 'account'] as const

export default function TabsLayout() {
  const { colors } = useTheme()
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: colors.brand, tabBarStyle: { backgroundColor: colors.page } }}>
      {routes.map((route) => (
        <Tabs.Screen key={route} name={route} options={{ title: t(`tabs.${route}`) }} />
      ))}
    </Tabs>
  )
}
