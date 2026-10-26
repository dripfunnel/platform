import { Tabs } from 'expo-router'
import { t } from '../../messages'
import { useTheme } from '@dripfunnel/mobile-shared/theme'

// shop/ARCHITECTURE.md §2: Home, Browse, Cart and Account; each tab's folder or file under (tabs).
const tabs = [
  { route: 'home', title: t('tabs.home') },
  { route: 'browse', title: t('tabs.browse') },
  { route: 'cart', title: t('tabs.cart') },
  { route: 'account', title: t('tabs.account') },
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
