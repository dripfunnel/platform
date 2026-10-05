import { screenStates, StateView, useScreenState } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/shell.css'
import { harnessEnabled } from '../../harness'
import { messages } from '../../messages'

// States (?state=): empty, loading, error, denied, readonly, confirm, from the shared kit.
// Every menu row leads to a screen (ui/README.md §5); each card replaces its placeholder.
export type ScreenKey = keyof typeof messages.screens

export const ScreenPlaceholder = ({ screen }: { screen: ScreenKey }) => {
  const forced = useScreenState(screenStates, harnessEnabled)
  return (
    <div className="df-page">
      <h1 className="df-page-title">{messages.screens[screen].title}</h1>
      {forced ? <StateView state={forced} words={messages.states} /> : <p className="df-page-lede">{messages.shell.placeholder}</p>}
    </div>
  )
}
