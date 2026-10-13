import { useRouter } from 'expo-router'
import type { ReactNode } from 'react'
import { ScrollView, StyleSheet } from 'react-native'
import { tabsFor } from '../../nav'
import { session } from '../../session'
import { useTheme } from '../../theme'
import { useShell } from '../shell/ShellData'
import { sampleReference, setScenario, useScenario } from './scenario'
import { StateView, type StateKind } from './StateView'

// What a screen draws in place of its content while the Scenario menu has a state on (DESIGN.md §4); a real failure
// draws the same views. `label` names the screen in "We couldn’t load {label}"; `state` is a real one the screen knows.
export function ShellScreen({ label, state, children }: { label: string; state?: StateKind; children: ReactNode }) {
  const { colors } = useTheme()
  const router = useRouter()
  const scenario = useScenario()
  const screen = scenario.screen === 'normal' ? (state ?? 'normal') : scenario.screen
  const { acting, seat, refresh } = useShell()

  return (
    <ScrollView style={{ backgroundColor: colors.page }} contentContainerStyle={styles.content}>
      {screen === 'normal' ? (
        children
      ) : (
        <StateView
          kind={screen}
          label={label}
          store={acting.storeName}
          supplier={seat?.side === 'supplier'}
          reference={sampleReference}
          onRetry={() => {
            setScenario({ screen: 'normal' })
            refresh()
          }}
          onHome={() => {
            setScenario({ screen: 'normal' })
            router.navigate(`/${tabsFor(seat)[0]?.route ?? 'more'}` as never)
          }}
          onSignIn={() => void session().end('expired')}
          onSwitchStore={() => session().leaveStore()}
        />
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  content: { flexGrow: 1 },
})
