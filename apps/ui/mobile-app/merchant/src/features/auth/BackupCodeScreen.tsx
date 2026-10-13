import { Redirect, useRouter } from 'expo-router'
import { useState } from 'react'
import { t } from '../../messages'
import { Button } from '../common/Button'
import { Notice } from '../common/Notice'
import { TextField } from '../common/TextField'
import { AuthFrame } from './AuthFrame'
import { flowDeps } from './deps'
import { usePending } from './pending'
import { failureOf, submitBackupCode } from './signInFlow'

// Eight letters and digits, like K4P2-9XQM; each works once (ACCESS.md §4).
const shape = /^[a-z0-9]{4}-?[a-z0-9]{4}$/i

export function BackupCodeScreen() {
  const router = useRouter()
  const pending = usePending()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (pending?.step !== 'second-factor') return <Redirect href="/sign-in" />

  const submit = async () => {
    if (!shape.test(code.trim())) {
      setError(t('auth.backupInvalid'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await submitBackupCode(flowDeps(), code)
    } catch (failed) {
      const failure = failureOf(failed, 'code')
      if (failure.locked !== null) router.replace({ pathname: '/locked', params: { minutes: String(failure.locked) } })
      else if (failure.expired) router.replace('/sign-in')
      else setError(failure.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthFrame title={t('auth.backupTitle')} sub={t('auth.backupSub')} back>
      {error ? <Notice kind="error" text={error} /> : null}
      <TextField label={t('auth.backupLabel')} value={code} onChangeText={setCode} code autoCapitalize="characters" autoComplete="one-time-code" placeholder={t('auth.backupPlaceholder')} invalid={error !== null} maxLength={9} />
      <Button label={t('auth.signInButton')} onPress={() => void submit()} busy={busy} />
    </AuthFrame>
  )
}
