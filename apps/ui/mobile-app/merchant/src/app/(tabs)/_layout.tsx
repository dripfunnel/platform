import { Tabs, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useBrand } from '../../brand/BrandProvider'
import { tabBarHiddenAt, tabsFor } from '../../nav'
import { useTheme } from '../../theme'
import { Banners } from '../../features/shell/Banners'
import { bannersFor } from '../../features/shell/bannerSpecs'
import { ShellHeader } from '../../features/shell/ShellHeader'
import { useShell } from '../../features/shell/ShellData'
import { TabBar } from '../../features/shell/TabBar'
import { ScenarioMenu } from '../../features/states/ScenarioMenu'
import { useScenario } from '../../features/states/scenario'

// Every folder or file under (tabs); the ones the signed-in role has no tab for are kept out of reach (`href: null`).
const routes = ['home', 'orders', 'catalogue', 'offers', 'products', 'to-ship', 'more'] as const

// The shell: header, banners, the screen, the tab bar from nav.ts (DESIGN.md §2). The status bar reads light on the
// header's colour, whatever the partner's primary is, because the header always carries white text.
export default function TabsLayout() {
  const { colors } = useTheme()
  const { seat, state, online, refresh } = useShell()
  const { brand } = useBrand()
  const scenario = useScenario()
  const segments = useSegments()
  const deep = segments.length > 2
  const [now, setNow] = useState(() => new Date())
  // While a support session is open its request to make changes can arrive, so the store's state is read again each minute.
  const supportOpen = state?.support != null
  useEffect(() => {
    const tick = setInterval(() => {
      setNow(new Date())
      if (supportOpen) refresh()
    }, 60_000)
    return () => clearInterval(tick)
  }, [supportOpen, refresh])

  const tabs = tabsFor(seat)
  const banners = bannersFor({ seat, state, support: brand?.supportEmail ?? brand?.supportUrl ?? null, online, scenario: scenario.banner, now })

  return (
    <View style={[styles.shell, { backgroundColor: colors.page }]}>
      <StatusBar style="light" />
      <ShellHeader deep={deep} />
      <Banners banners={banners} />
      <View style={styles.body}>
        <Tabs tabBar={(props) => (tabBarHiddenAt(segments) ? null : <TabBar {...props} />)} screenOptions={{ headerShown: false }}>
          {routes.map((name) => (
            <Tabs.Screen key={name} name={name} options={tabs.some((tab) => tab.route === name) ? {} : { href: null }} />
          ))}
        </Tabs>
        <ScenarioMenu />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  shell: { flex: 1 },
  body: { flex: 1 },
})
