import { ErrorState, LoadingState, Toast, useScreenState } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/states.css'
import { getRouteApi } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { loadProfile, loadSessions, type Profile, type SignedInSession } from '../../api/profile'
import { harnessEnabled } from '../../harness'
import { messages } from '../../messages'
import { Appearance } from './Appearance'
import { Details } from './Details'
import { MyActivity } from './MyActivity'
import { PasswordCard } from './PasswordCard'
import { profileSample, profileStates } from './profileStates'
import { Sessions } from './Sessions'
import { TwoStep } from './TwoStep'
import './profile.css'

const words = messages.profile
const shellRoute = getRouteApi('/_app')

type View = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; profile: Profile; sessions: SignedInSession[] }

// PortalProfile (FIRST-RELEASE §4): one account across this partner's stores, so nothing here depends
// on the acting store; ?state= per profileStates.ts.
export const ProfileScreen = () => {
  const { stores } = shellRoute.useLoaderData()
  const forced = useScreenState(profileStates, harnessEnabled)
  const sample = useMemo(() => profileSample(forced), [forced])
  const [view, setView] = useState<View>({ kind: 'loading' })
  const [toast, setToast] = useState<string | null>(null)
  const storeNames = useMemo(() => new Map(stores.map((choice) => [choice.store.id, choice.store.name])), [stores])

  const load = useCallback(() => {
    if (forced === 'loading') return setView({ kind: 'loading' })
    if (forced === 'error') return setView({ kind: 'error' })
    if (sample) return setView({ kind: 'ready', profile: sample.profile, sessions: sample.sessions })
    void Promise.all([loadProfile(), loadSessions()]).then(
      ([profile, sessions]) => setView(profile ? { kind: 'ready', profile, sessions } : { kind: 'error' }),
      () => setView({ kind: 'error' }),
    )
  }, [forced, sample])

  useEffect(load, [load])

  const saved = (profile: Profile) => setView((current) => (current.kind === 'ready' ? { ...current, profile } : current))

  return (
    <div className="df-profile">
      <div className="df-profile-head">
        <h1 className="df-page-title">{words.title}</h1>
        <p className="df-page-lede">{words.lede}</p>
      </div>
      {view.kind === 'loading' && <LoadingState label={words.loading} />}
      {view.kind === 'error' && <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry: load }} />}
      {view.kind === 'ready' && (
        <>
          <Details key={`${view.profile.email}-${view.profile.phone ?? ''}`} profile={view.profile} onSaved={saved} onToast={setToast} />
          <PasswordCard changedAt={view.profile.passwordChangedAt} onChanged={load} onToast={setToast} />
          <TwoStep key={forced ?? 'live'} profile={view.profile} onChanged={load} onToast={setToast} initialSetup={sample?.setup ?? null} />
          <Appearance profile={view.profile} onSaved={saved} onFailed={() => setToast(messages.auth.notConnected)} />
          <Sessions sessions={view.sessions} onEnded={load} onToast={setToast} />
          <MyActivity storeNames={storeNames} sample={sample?.activity} />
        </>
      )}
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  )
}
