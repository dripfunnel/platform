import { useState } from 'react'
import { signOutOtherSessions, type SignedInSession } from '../../api/profile'
import { fill, formatCount, formatTime, messages, plural } from '../../messages'
import { Alert, Card, Secondary } from './parts'
import { profileRefusal } from './profileWords'

const words = messages.profile.sessions

// "Where you're signed in": this browser first, then the others by last use (ACCESS.md §4 "Sign out everywhere else").
export const Sessions = ({ sessions, onEnded, onToast }: { sessions: readonly SignedInSession[]; onEnded: () => void; onToast: (text: string) => void }) => {
  const [error, setError] = useState<string | null>(null)
  const ordered = [...sessions].sort((a, b) => Number(b.current) - Number(a.current) || b.lastUsedAt.localeCompare(a.lastUsedAt))
  const others = sessions.some((s) => !s.current)
  const endOthers = () =>
    void signOutOtherSessions()
      .then((ended) => {
        setError(null)
        onToast(fill(plural(words.ended, ended), { count: formatCount(ended) }))
        onEnded()
      })
      .catch((failure: unknown) => setError(profileRefusal(failure, messages.auth.notConnected)))

  return (
    <Card title={words.title}>
      <ul className="df-profile-sessions">
        {ordered.map((session) => (
          <li key={`${session.createdAt}-${session.device ?? ''}`}>
            <span className="df-profile-row-text">
              <strong>{session.current ? words.thisBrowser : (session.device ?? words.unknownDevice)}</strong>
              <span>{session.current ? session.device : fill(words.lastUsed, { when: formatTime(session.lastUsedAt) })}</span>
            </span>
            {session.current && <span className="df-profile-active">{words.active}</span>}
          </li>
        ))}
      </ul>
      {!others && <p className="df-profile-note">{words.none}</p>}
      <Alert text={error} />
      {others && (
        <div>
          <Secondary size="small" onClick={endOthers}>{words.signOutOthers}</Secondary>
        </div>
      )}
    </Card>
  )
}
