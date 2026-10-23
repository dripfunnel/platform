import type { ReactNode } from 'react'
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '@dripfunnel/mobile-shared/theme'

// A scrolling screen that honours the safe areas and keeps the focused field in view above the keyboard (DESIGN.md §4).
// `header` is true under a navigation header, which already clears the top.
export function Screen({ children, header = false }: { children: ReactNode; header?: boolean }) {
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.screen, { backgroundColor: colors.page }]}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, { paddingTop: header ? 16 : insets.top + 24, paddingBottom: insets.bottom + 32 }]}>
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 20, gap: 18, flexGrow: 1 },
})
