import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { t } from '../../messages'
import { useTheme } from '../../theme'
import { BottomSheet, SheetFrame, type SheetSpec } from './BottomSheet'

export type MenuItem = { key: string; label: string; danger?: boolean; onPress: () => void }
export type MenuSpec = { title: string; sub?: string; items: readonly MenuItem[] }
export type ToastSpec = { message: string; undo?: () => void }

type Feedback = {
  sheet: (spec: SheetSpec) => void
  menu: (spec: MenuSpec) => void
  toast: (spec: ToastSpec) => void
}

const Context = createContext<Feedback | null>(null)

export const useFeedback = (): Feedback => {
  const feedback = useContext(Context)
  if (!feedback) throw new Error('useFeedback needs a FeedbackProvider above it')
  return feedback
}

// Four seconds, or six when it offers Undo; DESIGN.md §4 sets no time, so these are the app's own.
const toastMs = 4000
const undoMs = 6000

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [sheet, setSheet] = useState<SheetSpec | null>(null)
  const [menu, setMenu] = useState<MenuSpec | null>(null)
  const [toast, setToast] = useState<ToastSpec | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    setToast(null)
  }, [])

  const show = useCallback(
    (spec: ToastSpec) => {
      if (timer.current) clearTimeout(timer.current)
      setToast(spec)
      timer.current = setTimeout(clear, spec.undo ? undoMs : toastMs)
    },
    [clear],
  )

  useEffect(() => () => (timer.current ? clearTimeout(timer.current) : undefined), [])

  const value = useMemo<Feedback>(() => ({ sheet: setSheet, menu: setMenu, toast: show }), [show])

  return (
    <Context.Provider value={value}>
      {children}
      <ToastView toast={toast} onDismiss={clear} />
      {sheet ? <BottomSheet spec={sheet} onClose={() => setSheet(null)} /> : null}
      {menu ? <MenuSheet spec={menu} onClose={() => setMenu(null)} /> : null}
    </Context.Provider>
  )
}

// Sits above the tab bar so it never covers the way to another screen.
function ToastView({ toast, onDismiss }: { toast: ToastSpec | null; onDismiss: () => void }) {
  const { colors, radii } = useTheme()
  const insets = useSafeAreaInsets()
  if (!toast) return null
  return (
    <View pointerEvents="box-none" style={[styles.toastWrap, { bottom: insets.bottom + 54 + 12 }]}>
      <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={[styles.toast, { backgroundColor: colors.ink, borderRadius: radii.button }]}>
        <Text style={[styles.toastText, { color: colors.onInk }]}>{toast.message}</Text>
        {toast.undo ? (
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => {
              toast.undo?.()
              onDismiss()
            }}
          >
            <Text style={[styles.undo, { color: colors.brand }]}>{t('shell.undo')}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  )
}

// A list of actions in a sheet, each 50 tall; the one that signs out or loses something reads red.
function MenuSheet({ spec, onClose }: { spec: MenuSpec; onClose: () => void }) {
  const { colors, radii } = useTheme()
  return (
    <SheetFrame onClose={onClose}>
      <View style={styles.menuHead}>
        <Text accessibilityRole="header" style={[styles.menuTitle, { color: colors.heading }]}>
          {spec.title}
        </Text>
        {spec.sub ? <Text style={[styles.menuSub, { color: colors.muted }]}>{spec.sub}</Text> : null}
      </View>
      {spec.items.map((item) => (
        <Pressable
          key={item.key}
          accessibilityRole="button"
          onPress={() => {
            onClose()
            item.onPress()
          }}
          style={[styles.menuItem, { borderColor: colors.border, borderRadius: radii.button, backgroundColor: colors.surface }]}
        >
          <Text style={[styles.menuLabel, { color: item.danger ? colors.danger : colors.text }]}>{item.label}</Text>
        </Pressable>
      ))}
    </SheetFrame>
  )
}

const styles = StyleSheet.create({
  toastWrap: { position: 'absolute', left: 16, right: 16 },
  toast: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 16, paddingVertical: 14, minHeight: 48 },
  toastText: { flex: 1, fontSize: 14, lineHeight: 20 },
  undo: { fontSize: 14, fontWeight: '800' },
  menuHead: { gap: 2, paddingBottom: 4 },
  menuTitle: { fontSize: 17, fontWeight: '800' },
  menuSub: { fontSize: 13 },
  menuItem: { height: 50, justifyContent: 'center', paddingHorizontal: 16, borderWidth: 1 },
  menuLabel: { fontSize: 15, fontWeight: '700' },
})
