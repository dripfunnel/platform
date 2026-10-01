import { useRouterState } from '@tanstack/react-router'
import { parseScreenState } from './screenState'

// `enabled` is the app's `isHarnessEnabled(import.meta.env)`: each app decides if its harness is on.
export const useScreenState = <State extends string>(allowed: readonly State[], enabled: boolean): State | null => {
  const searchStr = useRouterState({ select: (state) => state.location.searchStr })
  if (!enabled) return null
  const values = new URLSearchParams(searchStr).getAll('state')
  return parseScreenState(values.length > 1 ? values : values[0], allowed)
}
