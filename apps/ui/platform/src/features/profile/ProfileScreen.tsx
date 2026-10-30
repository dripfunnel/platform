import { firstName, ListHeader, ReadOnlyNotice, Toast, useCurrentStaffSession, type PortalStaffSession } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/list.css'
import '@dripfunnel/shared/ui/detail.css'
import { getRouteApi, useRouter } from '@tanstack/react-router'
import { useCallback, useId, useState, type FormEvent } from 'react'
import type { Me } from '../../api/me'
import { changeMyPassword, updateMyName, type ProfileResult } from '../../api/profile'
import { staffSession } from '../../api/staffSession'
import { fill, formatCount, messages, plural } from '../../messages'
import '../settings/settings.css'

const words = messages.profile
const appRoute = getRouteApi('/_app')

const refusalText = (result: Exclude<ProfileResult, { ok: true }>): string => {
  if (result.reason === 'WRONG_PASSWORD' && result.triesLeft !== null) return fill(words.refusals.WRONG_PASSWORD_TRIES, { tries: fill(plural(words.tries, result.triesLeft), { count: formatCount(result.triesLeft) }) })
  if (result.reason === 'LOCKED') return fill(words.refusals.LOCKED, { minutes: formatCount(result.minutes ?? 15) })
  return words.refusals[result.reason]
}

// My profile (#1053; FIRST-RELEASE.md §14.6): the signed-in user's own name and password. No Platform prototype draws it,
// so it follows the Store portal's PortalProfile name and password, in this console's panels.
export const ProfileScreen = () => {
  const { me } = appRoute.useRouteContext()
  return <Profile me={me} session={useCurrentStaffSession(staffSession)} />
}

export const Profile = ({ me, session }: { me: Me; session: PortalStaffSession | null }) => {
  const router = useRouter()
  // A staff session never changes the user's own account (ACCESS.md §8.1, §8.2), as Settings' "Your account" says.
  const blocked = session && session.state === 'open' ? fill(messages.blocked[session.kind === 'impersonation' ? 'BLOCKED_WHILE_IMPERSONATING' : 'PARTNER_ENTERS_THIS_ITSELF'], { user: firstName(me.name), partner: me.partner.name }) : null
  const ids = { name: useId(), current: useId(), next: useId(), signsOut: useId(), reason: useId() }
  const [name, setName] = useState(me.name)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [shown, setShown] = useState(false)
  const [busy, setBusy] = useState<'name' | 'password' | null>(null)
  const [errors, setErrors] = useState<{ name: string | null; password: string | null }>({ name: null, password: null })
  const [toast, setToast] = useState<string | null>(null)
  const clearToast = useCallback(() => setToast(null), [])

  const run = (which: 'name' | 'password', work: () => Promise<ProfileResult>, done: () => void) => {
    setBusy(which)
    setErrors((e) => ({ ...e, [which]: null }))
    work()
      .then((result) => (result.ok ? done() : setErrors((e) => ({ ...e, [which]: refusalText(result) }))))
      .catch(() => setErrors((e) => ({ ...e, [which]: words.failed })))
      .finally(() => setBusy(null))
  }

  const saveName = (event: FormEvent) => {
    event.preventDefault()
    run('name', () => updateMyName(name.trim()), () => {
      setToast(words.name.saved)
      // The header reads the name from the shell's `me`, which this reads again.
      void router.invalidate()
    })
  }

  const savePassword = (event: FormEvent) => {
    event.preventDefault()
    if (next.length < 10) return setErrors((e) => ({ ...e, password: words.refusals.WEAK_PASSWORD }))
    run('password', () => changeMyPassword(current, next), () => {
      setCurrent('')
      setNext('')
      setToast(words.password.saved)
    })
  }

  const off = blocked !== null
  return (
    <div className="df-page df-list df-settings">
      <ListHeader title={words.title} sub={words.sub} />
      {blocked && <ReadOnlyNotice title={messages.states.readonly.title} body={blocked} />}
      <div className="df-panels">
        <section className="df-panel df-panel--wide" aria-labelledby="profile-name">
          <h2 id="profile-name">{words.name.title}</h2>
          <form onSubmit={saveName} noValidate>
            <div className="df-field">
              <label htmlFor={ids.name}>{words.name.label}</label>
              <input id={ids.name} type="text" autoComplete="name" maxLength={80} value={name} disabled={off} aria-invalid={errors.name !== null} onChange={(event) => setName(event.target.value)} />
              <p className="df-field-hint">{words.name.hint}</p>
            </div>
            {errors.name && <p role="alert">{errors.name}</p>}
            <div className="df-settings-row-actions">
              <button type="submit" className="df-button df-button--primary" disabled={off || busy !== null || name.trim() === me.name}>
                {words.name.save}
              </button>
            </div>
          </form>
        </section>
        <section className="df-panel df-panel--wide" aria-labelledby="profile-password">
          <h2 id="profile-password">{words.password.title}</h2>
          <form onSubmit={savePassword} noValidate>
            <div className="df-field">
              <label htmlFor={ids.current}>{words.password.current}</label>
              <input id={ids.current} type={shown ? 'text' : 'password'} autoComplete="current-password" maxLength={1024} value={current} disabled={off} onChange={(event) => setCurrent(event.target.value)} />
            </div>
            <div className="df-field">
              <label htmlFor={ids.next}>{words.password.new}</label>
              <input id={ids.next} type={shown ? 'text' : 'password'} autoComplete="new-password" maxLength={1024} value={next} disabled={off} aria-describedby={ids.signsOut} onChange={(event) => setNext(event.target.value)} />
              <p className="df-field-hint">{words.password.hint}</p>
            </div>
            <p id={ids.signsOut} className="df-muted">
              {words.password.signsOut}
            </p>
            {errors.password && <p role="alert">{errors.password}</p>}
            <div className="df-settings-row-actions">
              <button type="button" className="df-button" disabled={off} aria-pressed={shown} onClick={() => setShown((s) => !s)}>
                {shown ? words.password.hide : words.password.show}
              </button>
              <button type="submit" className="df-button df-button--primary" disabled={off || busy !== null || current === '' || next === ''}>
                {words.password.save}
              </button>
            </div>
          </form>
        </section>
      </div>
      <Toast message={toast} onDone={clearToast} />
    </div>
  )
}
