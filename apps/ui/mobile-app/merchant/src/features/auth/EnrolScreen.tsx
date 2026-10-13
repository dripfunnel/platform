import { Redirect, useRouter } from 'expo-router'
import { useState } from 'react'
import { t } from '../../messages'
import { BackupCodes } from '../common/BackupCodes'
import { Button } from '../common/Button'
import { Notice } from '../common/Notice'
import { TextField } from '../common/TextField'
import { AuthFrame } from './AuthFrame'
import { flowDeps } from './deps'
import { pendingStore, usePending } from './pending'
import { confirmEnrolCode, failureOf, finishEnrol, sendEnrolCode } from './signInFlow'

// An Owner without two-step sign-in is held here before the store opens (ACCESS.md §4, FIRST-RELEASE §4): the mobile
// number, the code texted to it, then the ten backup codes, shown once.
export function EnrolScreen() {
  const router = useRouter()
  const pending = usePending()
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (pending?.step !== 'enrol') return <Redirect href="/sign-in" />

  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await work()
    } catch (failed) {
      const failure = failureOf(failed, 'code')
      if (failure.locked !== null) router.replace({ pathname: '/locked', params: { minutes: String(failure.locked) } })
      else if (failure.expired) router.replace('/sign-in')
      else setError(failure.message)
    } finally {
      setBusy(false)
    }
  }

  if (pending.phase === 'codes') {
    return (
      <AuthFrame title={t('auth.codesTitle')} sub={t('auth.codesSub')}>
        <BackupCodes codes={pending.codes} shareLabel={t('auth.shareCodes')} />
        <Button label={t('auth.codesSaved')} onPress={() => void run(() => finishEnrol(flowDeps()))} busy={busy} />
      </AuthFrame>
    )
  }

  if (pending.phase === 'code') {
    return (
      <AuthFrame
        title={t('auth.enrolTitle')}
        sub={t('auth.enrolCodeSub', { hint: pending.hint ?? '' })}
        back
        onBack={() => {
          pendingStore.set({ ...pending, phase: 'phone' })
          setCode('')
          setError(null)
        }}
      >
        {error ? <Notice kind="error" text={error} /> : null}
        <TextField label={t('auth.code')} value={code} onChangeText={(value) => setCode(value.replace(/\D/g, '').slice(0, 6))} code keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={6} placeholder={t('auth.codePlaceholder')} invalid={error !== null} />
        <Button
          label={t('auth.enrolConfirm')}
          onPress={() => (code.length === 6 ? void run(() => confirmEnrolCode(flowDeps(), code)) : setError(t('auth.codeLength')))}
          busy={busy}
        />
      </AuthFrame>
    )
  }

  return (
    <AuthFrame title={t('auth.enrolTitle')} sub={t('auth.enrolPhoneSub')} back>
      {error ? <Notice kind="error" text={error} /> : null}
      <TextField label={t('auth.phone')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" placeholder={t('auth.phonePlaceholder')} invalid={error !== null} />
      <Button label={t('auth.enrolSend')} onPress={() => void run(() => sendEnrolCode(flowDeps(), phone))} busy={busy} />
    </AuthFrame>
  )
}
