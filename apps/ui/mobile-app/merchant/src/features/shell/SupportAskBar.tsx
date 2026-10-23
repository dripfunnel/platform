import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { loadAccess } from '../../api/products'
import { answerSupportWrite } from '../../api/settingsSupport'
import { t } from '../../messages'
import { sessionClient } from '../../session'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { useLoad } from '../common/useLoad'
import { FormSheet } from '../settings/FormSheet'
import type { SupportAsk } from './bannerSpecs'
import { useShell } from './ShellData'

// The elevation banner's Allow and Deny (ACCESS.md §8): support asks to make changes for this one session, and an Owner or a Manager
// (`support.allow_write`) answers. Each answer says what it does first; the API decides again, and a request no longer open is `NOT_PENDING`.
export function SupportAskBar({ ask, color }: { ask: SupportAsk; color: string }) {
  const { colors } = useTheme()
  const { refresh } = useShell()
  const client = sessionClient()
  const access = useLoad(() => loadAccess(client), [client])
  const [answering, setAnswering] = useState<'allow' | 'deny' | null>(null)
  if (access.state.status !== 'ready' || !access.state.data.permissions.includes('support.allow_write')) return null

  const answer = async (allow: boolean): Promise<string> => {
    await answerSupportWrite(client, ask.sessionId, allow)
    refresh()
    return t(allow ? 'banners.support.allowed' : 'banners.support.denied', { name: ask.agent })
  }
  const words = { agent: ask.agent, partner: ask.partner }

  return (
    <View style={styles.ask}>
      <Text style={[styles.text, { color }]}>{ask.note ? t('banners.support.asksNote', { ...words, note: ask.note }) : t('banners.support.asks', words)}</Text>
      <View style={styles.buttons}>
        {(['allow', 'deny'] as const).map((choice) => (
          <Pressable
            key={choice}
            accessibilityRole="button"
            accessibilityLabel={t(`banners.support.${choice}Label`)}
            onPress={() => setAnswering(choice)}
            style={[styles.button, { borderColor: color, backgroundColor: choice === 'allow' ? colors.surface : 'transparent' }]}
          >
            <Text style={[styles.label, { color: choice === 'allow' ? colors.text : color }]}>{t(`banners.support.${choice}Label`)}</Text>
          </Pressable>
        ))}
      </View>

      {answering === 'allow' ? (
        <FormSheet
          title={t('banners.support.allowTitle', words)}
          body={t('banners.support.allowBody', words)}
          confirm={t('banners.support.allowGo')}
          context="support"
          onClose={() => setAnswering(null)}
          onSubmit={() => answer(true)}
        />
      ) : null}
      {answering === 'deny' ? (
        <FormSheet
          title={t('banners.support.denyTitle', words)}
          body={t('banners.support.denyBody', words)}
          confirm={t('banners.support.denyGo')}
          context="support"
          onClose={() => setAnswering(null)}
          onSubmit={() => answer(false)}
        />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  ask: { gap: 6, paddingTop: 6 },
  text: { fontSize: 12, lineHeight: 17 },
  buttons: { flexDirection: 'row', gap: 8 },
  button: { minHeight: 44, paddingHorizontal: 18, borderWidth: 1, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 13, fontWeight: '700' },
})
