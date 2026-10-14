import { useState } from 'react'
import { Alert, StyleSheet, Text, View } from 'react-native'
import { signOutOtherSessions, type SignedInSession } from '../../api/profile'
import { formatDateTime } from '../../format'
import { locale, t } from '../../messages'
import { errorMessage } from '../../messages/errorMessage'
import { sessionClient } from '../../session'
import { useTheme } from '../../theme'
import { Button } from '../common/Button'
import { Notice } from '../common/Notice'
import { SectionCard } from './SectionCard'

// The person's own sessions, this one marked, and "Sign out everywhere else" (ACCESS.md §4). One chosen session can't be ended.
export function SessionsSection({ sessions, onChanged }: { sessions: readonly SignedInSession[]; onChanged: () => void }) {
  const { colors } = useTheme()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const others = sessions.filter((session) => !session.current).length

  const endOthers = async () => {
    setBusy(true)
    setError(null)
    try {
      await signOutOtherSessions(sessionClient())
      setDone(t('profile.signedOutOthers', { count: others }))
      onChanged()
    } catch (failed) {
      setError(errorMessage(failed, 'profile'))
    } finally {
      setBusy(false)
    }
  }

  const confirm = () =>
    Alert.alert(t('profile.signOutOthersTitle'), t('profile.signOutOthersBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('profile.signOutOthers'), style: 'destructive', onPress: () => void endOthers() },
    ])

  return (
    <SectionCard title={t('profile.sessionsTitle')}>
      {error ? <Notice kind="error" text={error} /> : done ? <Notice kind="success" text={done} /> : null}
      {sessions.map((session, index) => (
        <View key={`${session.createdAt ?? index}:${session.device ?? ''}`} style={[styles.row, { borderTopColor: colors.border }]}>
          <View style={styles.text}>
            <Text style={[styles.device, { color: colors.text }]}>{session.device ?? t('profile.sessionUnknownDevice')}</Text>
            {session.lastUsedAt ? <Text style={[styles.sub, { color: colors.muted }]}>{t('profile.sessionLastUsed', { when: formatDateTime(session.lastUsedAt, locale, 'UTC') })}</Text> : null}
          </View>
          {session.current ? <Text style={[styles.sub, { color: colors.success }]}>{t('profile.sessionActive')}</Text> : null}
        </View>
      ))}
      {others > 0 ? <Button kind="secondary" label={t('profile.signOutOthers')} onPress={confirm} busy={busy} saves /> : null}
    </SectionCard>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: 1, paddingTop: 10, minHeight: 44 },
  text: { flex: 1, gap: 2 },
  device: { fontSize: 14, fontWeight: '700' },
  sub: { fontSize: 12 },
})
