// States: empty, loading, error, denied, readonly, confirm. Dev-only (issue #16).
import { Link } from '@tanstack/react-router'
import { messages } from '../../messages'
import { screenStates, StateView, useScreenState } from '@dripfunnel/shared/ui'
import { harnessEnabled } from '../../harness'
import './gallery.css'

const words = messages.states.gallery

export const StateGallery = () => {
  const state = useScreenState(screenStates, harnessEnabled)
  return (
    <div className="df-gallery">
      <h1>{words.title}</h1>
      <p>{words.intro}</p>
      <nav aria-label={words.pick}>
        <ul>
          {screenStates.map((name) => (
            <li key={name}>
              <Link to="/states" search={{ state: name }} aria-current={name === state ? 'page' : undefined}>
                {words.names[name]}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {state && <StateView state={state} words={messages.states} />}
    </div>
  )
}
