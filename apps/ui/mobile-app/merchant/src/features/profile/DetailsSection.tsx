import { useState } from 'react'
import { changeEmail, saveDetails, type Profile } from '../../api/profile'
import { t } from '../../messages'
import { errorMessage } from '../../messages/errorMessage'
import { sessionClient } from '../../session'
import { Button } from '../common/Button'
import { Notice } from '../common/Notice'
import { TextField } from '../common/TextField'
import { SectionCard } from '../common/SectionCard'

const looksLikeEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

// Name, email and the mobile number a texted code goes to. The email changes through a link sent to the new
// address, so the API asks for the current password first (ACCESS.md §4).
export function DetailsSection({ profile, onSaved }: { profile: Profile; onSaved: () => void }) {
  const [name, setName] = useState(profile.name ?? '')
  const [email, setEmail] = useState(profile.email)
  const [phone, setPhone] = useState(profile.phone ?? '')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const detailsChanged = name !== (profile.name ?? '') || phone !== (profile.phone ?? '')
  const emailChanged = email.trim() !== profile.email
  const dirty = detailsChanged || emailChanged

  const save = async () => {
    if (!name.trim()) {
      setError(t('errors.NAME_REQUIRED'))
      return
    }
    if (emailChanged && !looksLikeEmail.test(email.trim())) {
      setError(t('errors.INVALID_EMAIL'))
      return
    }
    if (emailChanged && !password) {
      setError(t('profile.passwordMissing'))
      return
    }
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      const client = sessionClient()
      if (detailsChanged) await saveDetails(client, { name: name.trim(), phone: phone.trim() === '' ? null : phone.trim() })
      if (emailChanged) await changeEmail(client, email, password)
      setDone(emailChanged ? t('profile.emailSent', { email: email.trim() }) : t('profile.detailsSaved'))
      setEmail(profile.email)
      setPassword('')
      onSaved()
    } catch (failed) {
      setError(errorMessage(failed, 'profile'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SectionCard title={t('profile.detailsTitle')}>
      {error ? <Notice kind="error" text={error} /> : done ? <Notice kind="success" text={done} /> : null}
      <TextField label={t('profile.name')} value={name} onChangeText={setName} autoCapitalize="words" autoComplete="name" textContentType="name" />
      <TextField
        label={t('profile.email')}
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoComplete="email"
        textContentType="emailAddress"
        help={profile.pendingEmail ? t('profile.emailPending', { email: profile.pendingEmail }) : emailChanged ? t('profile.emailHelpChanged') : t('profile.emailHelp')}
      />
      {emailChanged ? <TextField label={t('profile.emailPassword')} value={password} onChangeText={setPassword} secret autoComplete="current-password" textContentType="password" help={t('profile.emailPasswordHelp')} /> : null}
      <TextField label={t('profile.mobile')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" placeholder={t('profile.mobilePlaceholder')} />
      <Button label={t('profile.saveDetails')} onPress={() => void save()} busy={busy} disabled={!dirty} saves />
    </SectionCard>
  )
}
