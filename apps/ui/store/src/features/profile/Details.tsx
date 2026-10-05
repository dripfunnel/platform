import { useState, type FormEvent } from 'react'
import { changeEmail, updateProfile, type Profile } from '../../api/profile'
import { fill, messages } from '../../messages'
import { Alert, Card, Field, Primary } from './parts'
import { profileRefusal } from './profileWords'

const words = messages.profile.details

const emailLooksValid = (email: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)

// "Your details": name and mobile save at once; a new email needs the password and changes only when
// the link sent to it is clicked (ACCESS.md §4). The sign-in number changes only by switching method.
export const Details = ({ profile, onSaved, onToast }: { profile: Profile; onSaved: (profile: Profile) => void; onToast: (text: string) => void }) => {
  const [name, setName] = useState(profile.name)
  const [email, setEmail] = useState(profile.email)
  const [phone, setPhone] = useState(profile.phone ?? '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const smsNumber = profile.twoFactor.method === 'sms'
  const detailsChanged = name !== profile.name || phone.trim() !== (profile.phone ?? '')
  const emailChanged = email.trim().toLowerCase() !== profile.email.toLowerCase()
  const dirty = detailsChanged || emailChanged
  const edit = (set: (value: string) => void) => (value: string) => {
    set(value)
    setError(null)
  }

  const save = (event: FormEvent) => {
    event.preventDefault()
    if (!dirty || busy) return
    if (!name.trim()) return setError(words.nameMissing)
    if (emailChanged && !emailLooksValid(email.trim())) return setError(words.emailBad)
    if (emailChanged && !password) return setError(words.passwordMissing)
    setBusy(true)
    void (async () => {
      try {
        if (detailsChanged) onSaved(await updateProfile({ name: name.trim(), phone: phone.trim() || null, theme: profile.theme }))
        if (emailChanged) {
          await changeEmail(email.trim(), password)
          setEmail(profile.email)
          setPassword('')
          onToast(fill(words.sent, { email: email.trim() }))
        } else onToast(words.saved)
      } catch (failure) {
        setError(profileRefusal(failure, messages.auth.notConnected))
      } finally {
        setBusy(false)
      }
    })()
  }

  return (
    <Card title={words.title}>
      <form className="df-profile-form" onSubmit={save} noValidate>
        <div className="df-profile-grid df-profile-grid--two">
          <Field label={words.name} autoComplete="name" value={name} onValue={edit(setName)} />
          <Field label={words.email} type="email" autoComplete="email" value={email} onValue={edit(setEmail)} help={emailChanged ? words.emailChanging : profile.pendingEmail ? fill(words.pending, { email: profile.pendingEmail }) : words.emailHelp} />
          <Field
            label={words.phone}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder={words.phonePlaceholder}
            value={phone}
            onValue={edit(setPhone)}
            readOnly={smsNumber}
            help={smsNumber ? words.phoneLocked : undefined}
          />
          {emailChanged && <Field label={words.password} type="password" autoComplete="current-password" value={password} onValue={edit(setPassword)} help={words.passwordHelp} />}
        </div>
        <Alert text={error} />
        <div className="df-profile-actions">
          <Primary type="submit" busy={busy} disabled={!dirty || busy}>
            {words.save}
          </Primary>
        </div>
      </form>
    </Card>
  )
}
