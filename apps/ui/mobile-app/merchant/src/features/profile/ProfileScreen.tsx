import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text } from 'react-native'
import { loadProfile, loadSessions, type Profile, type SignedInSession } from '../../api/profile'
import { isApiError } from '../../graphql'
import { t } from '../../messages'
import { sessionClient } from '../../session'
import { useTheme } from '../../theme'
import { confirmSignOut } from '../auth/confirmSignOut'
import { Button } from '../common/Button'
import { Notice } from '../common/Notice'
import { Screen } from '../common/Screen'
import { DetailsSection } from './DetailsSection'
import { PasswordSection } from './PasswordSection'
import { SessionsSection } from './SessionsSection'
import { TwoStepSection } from './TwoStepSection'

type Loaded = { profile: Profile; sessions: SignedInSession[] }

// My profile (FIRST-RELEASE.md §4, `PortalProfile`): one account for every store the person belongs to.
export function ProfileScreen() {
  const { colors } = useTheme()
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    try {
      const client = sessionClient()
      const [profile, sessions] = await Promise.all([loadProfile(client), loadSessions(client)])
      setLoaded({ profile, sessions })
      setFailed(false)
    } catch (error) {
      // An answer of UNAUTHENTICATED has already ended the session, which sends the person to sign in.
      if (!isApiError(error, 'UNAUTHENTICATED')) setFailed(true)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (!loaded) {
    return (
      <Screen header>
        {failed ? (
          <>
            <Notice kind="error" text={t('profile.loadError')} />
            <Button label={t('common.tryAgain')} onPress={() => void load()} />
          </>
        ) : (
          <ActivityIndicator color={colors.muted} />
        )}
      </Screen>
    )
  }

  return (
    <Screen header>
      <Text style={[styles.sub, { color: colors.muted }]}>{t('profile.sub')}</Text>
      <DetailsSection key={`${loaded.profile.name}:${loaded.profile.email}:${loaded.profile.phone}`} profile={loaded.profile} onSaved={() => void load()} />
      <PasswordSection profile={loaded.profile} />
      <TwoStepSection profile={loaded.profile} onChanged={() => void load()} />
      <SessionsSection sessions={loaded.sessions} onChanged={() => void load()} />
      <Button kind="secondary" label={t('profile.signOut')} onPress={confirmSignOut} />
    </Screen>
  )
}

const styles = StyleSheet.create({
  sub: { fontSize: 14, lineHeight: 21 },
})
