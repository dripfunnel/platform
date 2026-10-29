import { Component, type ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { reportError } from '@dripfunnel/mobile-shared/crash'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { Button } from '../features/common/Button'
import { t } from '../messages'

type State = { failed: boolean }

function Failed({ onRetry }: { onRetry: () => void }) {
  const { colors } = useTheme()
  return (
    <View accessibilityRole="alert" style={[styles.screen, { backgroundColor: colors.page }]}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
        {t('crash.title')}
      </Text>
      <Text style={[styles.body, { color: colors.muted }]}>{t('crash.body')}</Text>
      <Button label={t('common.tryAgain')} onPress={onRetry} />
    </View>
  )
}

/** Around the routes: a screen that throws is reported (scrubbed) and replaced by a message that says it can be tried again, instead of a blank app. */
export class CrashBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  override componentDidCatch(error: Error): void {
    reportError(error)
  }

  override render() {
    if (!this.state.failed) return this.props.children
    return <Failed onRetry={() => this.setState({ failed: false })} />
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 20, fontWeight: '700' },
  body: { fontSize: 15, lineHeight: 22, marginBottom: 12 },
})
