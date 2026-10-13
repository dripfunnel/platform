import { Tabs } from 'expo-router'
import { t } from '../../messages'
import { useTheme } from '../../theme'

export default function TabsLayout() {
  const { colors } = useTheme()
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.side },
        headerTintColor: colors.sideText,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.heading,
        tabBarInactiveTintColor: colors.muted,
      }}
    >
      <Tabs.Screen name="home" options={{ title: t('tabs.home') }} />
      <Tabs.Screen name="orders" options={{ title: t('tabs.orders') }} />
      <Tabs.Screen name="catalogue" options={{ title: t('tabs.catalogue') }} />
      <Tabs.Screen name="offers" options={{ title: t('tabs.offers') }} />
      <Tabs.Screen name="more" options={{ title: t('tabs.more') }} />
    </Tabs>
  )
}
