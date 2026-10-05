import { useState, type FormEvent } from 'react'
import { changePassword } from '../../api/profile'
import { fill, formatCount, formatTime, messages, plural } from '../../messages'
import { Alert, Card, Field, Primary, Secondary } from './parts'
import { profileRefusal } from './profileWords'

const words = messages.profile.password
const minLength = 10

/** The new password's help line: how many characters are missing, then "Strong enough". */
export const passwordHint = (next: string): { text: string; tone: 'muted' | 'good' } => {
  if (!next) return { text: words.hint, tone: 'muted' }
  if (next.length >= minLength) return { text: words.strong, tone: 'good' }
  const missing = minLength - next.length
  return { text: fill(plural(words.more, missing), { count: formatCount(missing) }), tone: 'muted' }
}

// "Password": the current one proves it is you; a change signs out every other device (ACCESS.md §4).
export const PasswordCard = ({ changedAt, onChanged, onToast }: { changedAt: string | null; onChanged: () => void; onToast: (text: string) => void }) => {
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const hint = passwordHint(next)
  const close = () => {
    setOpen(false)
    setCurrent('')
    setNext('')
    setAgain('')
    setError(null)
  }
  const edit = (set: (value: string) => void) => (value: string) => {
    set(value)
    setError(null)
  }

  const save = (event: FormEvent) => {
    event.preventDefault()
    if (!current) return setError(words.currentMissing)
    if (next.length < minLength) return setError(words.weak)
    if (next !== again) return setError(words.mismatch)
    setBusy(true)
    void changePassword(current, next)
      .then(() => {
        close()
        onToast(words.done)
        onChanged()
      })
      .catch((failure: unknown) => setError(profileRefusal(failure, messages.auth.notConnected)))
      .finally(() => setBusy(false))
  }

  return (
    <Card title={words.title} sub={changedAt ? fill(words.changedAt, { date: formatTime(changedAt) }) : words.never} aside={open ? undefined : <Secondary size="strong" onClick={() => setOpen(true)}>{words.open}</Secondary>}>
      {open && (
        <form className="df-profile-form" onSubmit={save} noValidate>
          <div className="df-profile-grid df-profile-grid--three">
            <Field label={words.current} type="password" autoComplete="current-password" value={current} onValue={edit(setCurrent)} />
            <Field label={words.next} type="password" autoComplete="new-password" value={next} onValue={edit(setNext)} help={hint.text} helpTone={hint.tone} />
            <Field label={words.again} type="password" autoComplete="new-password" value={again} onValue={edit(setAgain)} />
          </div>
          <Alert text={error} />
          <div className="df-profile-actions">
            <Secondary onClick={close}>{words.cancel}</Secondary>
            <Primary type="submit" busy={busy}>
              {words.save}
            </Primary>
          </div>
          <p className="df-profile-note">{words.note}</p>
        </form>
      )}
    </Card>
  )
}
