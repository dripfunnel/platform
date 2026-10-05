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

/** What stops the change before it is sent, in the order the person would fix it; null when it can go. */
export const passwordProblem = (current: string, next: string, again: string): string | null => {
  if (!current) return words.currentMissing
  if (next.length < minLength) return words.weak
  if (next !== again) return words.mismatch
  return null
}

/** The change, refused before sending or by the server, worded; `{ ok: true }` once every other device is signed out. */
export const submitPassword = async (
  form: { current: string; next: string; again: string },
  send: (current: string, next: string) => Promise<void> = changePassword,
): Promise<{ ok: true } | { ok: false; error: string }> => {
  const problem = passwordProblem(form.current, form.next, form.again)
  if (problem) return { ok: false, error: problem }
  try {
    await send(form.current, form.next)
    return { ok: true }
  } catch (failure) {
    return { ok: false, error: profileRefusal(failure, messages.auth.notConnected) }
  }
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
    setBusy(true)
    void submitPassword({ current, next, again }).then((result) => {
      setBusy(false)
      if (!result.ok) return setError(result.error)
      close()
      onToast(words.done)
      onChanged()
    })
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
