import { screenStates, StateView, useScreenState } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/shell.css'
import { getRouteApi } from '@tanstack/react-router'
import { fill, messages } from '../../messages'
import { harnessEnabled } from '../../harness'
import type { NavKey } from '../../nav'

// States (?state=): empty, loading, error, denied, readonly, confirm, from the shared kit.
// An explicit placeholder, so every nav row resolves to a screen (docs/ui/README.md §5) until
// its card builds it (#112–#118 and the next batch).
const shellRoute = getRouteApi('/_app')

export const ScreenPlaceholder = ({ screen }: { screen: NavKey }) => {
  const { me } = shellRoute.useLoaderData()
  const forced = useScreenState(screenStates, harnessEnabled)
  const words = messages.screens[screen]
  return (
    <div className="df-page">
      <h1 className="df-page-title">{words.title}</h1>
      <p className="df-page-lede">{fill(words.lede, { product: me.partner.product })}</p>
      {forced ? <StateView state={forced} words={messages.states} /> : <p className="df-page-lede">{messages.shell.placeholder}</p>}
    </div>
  )
}
