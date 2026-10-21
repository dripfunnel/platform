import type { ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { t } from '../../messages'
import { useTheme } from '../../theme'
import { ShellScreen } from '../states/ShellScreen'
import type { StateKind } from '../states/StateView'

// Every tab and More item has a screen until its own card builds it; the shell's states draw over it (DESIGN.md §4).
export function PlaceholderScreen({ title, state, children }: { title: string; state?: StateKind; children?: ReactNode }) {
  const { colors } = useTheme()
  return (
    <ShellScreen label={title} {...(state ? { state } : {})}>
      <View style={styles.screen}>
        {children}
        <Text style={[styles.title, { color: colors.heading }]}>{title}</Text>
        <Text style={{ color: colors.text }}>{t('placeholder.body')}</Text>
      </View>
    </ShellScreen>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 64 },
  title: { fontSize: 20, fontWeight: '700' },
})
