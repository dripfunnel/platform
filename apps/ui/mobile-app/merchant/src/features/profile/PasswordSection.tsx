import { useState } from 'react'
import { changePassword, type Profile } from '../../api/profile'
import { formatDateTime } from '@dripfunnel/mobile-shared/format'
import { locale, t } from '../../messages'
import { errorMessage } from '../../messages/errorMessage'
import { sessionClient } from '../../session'
import { Button } from '../common/Button'
import { Notice } from '../common/Notice'
import { TextField } from '../common/TextField'
import { SectionCard } from '../common/SectionCard'

const minimumLength = 10

// Changing it ends every other session of the person, and the screen says so first (ACCESS.md §4).
export function PasswordSection({ profile }: { profile: Profile }) {
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const close = () => {
    setOpen(false)
    setCurrent('')
    setNext('')
    setAgain('')
    setError(null)
  }

  const save = async () => {
    if (!current) return setError(t('profile.passwordMissing'))
    if (next.length < minimumLength) return setError(t('profile.passwordShort'))
    if (next !== again) return setError(t('profile.passwordMismatch'))
    setBusy(true)
    setError(null)
    try {
      await changePassword(sessionClient(), current, next)
      close()
      setDone(t('profile.passwordDone'))
    } catch (failed) {
      setError(errorMessage(failed, 'password'))
    } finally {
      setBusy(false)
    }
  }

  const strong = next.length >= minimumLength
  const when = profile.passwordChangedAt ? t('profile.passwordChanged', { date: formatDateTime(profile.passwordChangedAt, locale, 'UTC') }) : t('profile.passwordNever')

  return (
    <SectionCard title={t('profile.passwordTitle')} sub={when}>
      {done ? <Notice kind="success" text={done} /> : null}
      {open ? (
        <>
          {error ? <Notice kind="error" text={error} /> : null}
          <TextField label={t('profile.currentPassword')} value={current} onChangeText={setCurrent} secret autoComplete="current-password" textContentType="password" />
          <TextField
            label={t('profile.newPassword')}
            value={next}
            onChangeText={setNext}
            secret
            autoComplete="new-password"
            textContentType="newPassword"
            help={next ? (strong ? t('profile.passwordStrong') : t('profile.passwordMore', { count: minimumLength - next.length })) : t('profile.passwordHint')}
          />
          <TextField label={t('profile.againPassword')} value={again} onChangeText={setAgain} secret autoComplete="new-password" textContentType="newPassword" invalid={again !== '' && again !== next} />
          <Notice text={t('profile.passwordNote')} />
          <Button label={t('profile.changePassword')} onPress={() => void save()} busy={busy} saves />
          <Button kind="secondary" label={t('common.cancel')} onPress={close} />
        </>
      ) : (
        <Button
          kind="secondary"
          label={t('profile.changePassword')}
          onPress={() => {
            setDone(null)
            setOpen(true)
          }}
        />
      )}
    </SectionCard>
  )
}
