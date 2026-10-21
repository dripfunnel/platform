import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { t, type MessageKey } from '../../messages'
import { useTheme } from '../../theme'
import { SheetFrame } from '../shell/BottomSheet'
import { resetScenario, setScenario, useScenario, type Scenario } from './scenario'

const options: { [K in keyof Scenario]: readonly Scenario[K][] } = {
  screen: ['normal', 'slow', 'loadErr', 'notFound', 'denied', 'expired', 'removed', 'offline'],
  banner: ['real', 'none', 'trial', 'trialEnds', 'trialEnded', 'bandwidth', 'whiteLabel', 'pastDue', 'provisioning', 'support', 'offline'],
  role: ['real', 'owner', 'manager', 'staff', 'supplierStock', 'supplierCatalogue', 'supplierOrders', 'supplierAdmin'],
  mode: ['real', 'light', 'dark'],
}

// The web portal's `?state=` harness for the phone: a small button, development builds only, that picks which state,
// banner, role and look the shell draws, so each can be photographed without a store in that state (#499).
export function ScenarioMenu() {
  const [open, setOpen] = useState(false)
  const { colors, radii } = useTheme()
  const insets = useSafeAreaInsets()
  const scenario = useScenario()
  if (!__DEV__) return null

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('scenario.open')}
        onPress={() => setOpen(true)}
        style={[styles.open, { backgroundColor: colors.ink, bottom: insets.bottom + 54 + 14 }]}
      >
        <Text style={[styles.openText, { color: colors.onInk }]}>{t('scenario.open')}</Text>
      </Pressable>
      {open ? (
        <SheetFrame onClose={() => setOpen(false)}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
            {t('scenario.title')}
          </Text>
          <Text style={[styles.note, { color: colors.muted }]}>{t('scenario.note')}</Text>
          {(Object.keys(options) as (keyof Scenario)[]).map((group) => (
            <View key={group} style={styles.group}>
              <Text style={[styles.groupTitle, { color: colors.muted }]}>{t(`scenario.group.${group}` as MessageKey)}</Text>
              <View style={styles.chips}>
                {options[group].map((value) => {
                  const selected = scenario[group] === value
                  return (
                    <Pressable
                      key={value}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      onPress={() => setScenario({ [group]: value })}
                      style={[styles.chip, { borderRadius: radii.button, borderColor: selected ? colors.focus : colors.fieldBorder, backgroundColor: selected ? colors.selected : colors.surface }]}
                    >
                      <Text style={[styles.chipText, { color: colors.text }]}>{t(`scenario.${group}.${value}` as MessageKey)}</Text>
                    </Pressable>
                  )
                })}
              </View>
            </View>
          ))}
          <Pressable accessibilityRole="button" onPress={resetScenario} style={[styles.reset, { borderColor: colors.fieldBorder, borderRadius: radii.button }]}>
            <Text style={[styles.chipText, { color: colors.text }]}>{t('scenario.reset')}</Text>
          </Pressable>
        </SheetFrame>
      ) : null}
    </>
  )
}

const styles = StyleSheet.create({
  open: { position: 'absolute', left: 12, height: 32, paddingHorizontal: 12, borderRadius: 16, alignItems: 'center', justifyContent: 'center', opacity: 0.85 },
  openText: { fontSize: 12, fontWeight: '700' },
  title: { fontSize: 19, fontWeight: '800' },
  note: { fontSize: 13, lineHeight: 19 },
  group: { gap: 6 },
  groupTitle: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { minHeight: 36, paddingHorizontal: 12, justifyContent: 'center', borderWidth: 1 },
  chipText: { fontSize: 13, fontWeight: '600' },
  reset: { height: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
})
