import { useRouterState } from '@tanstack/react-router'
import { isHarnessEnabled, parseScreenState, type ScreenState } from './screenState'

export const harnessEnabled = isHarnessEnabled(import.meta.env)

export const useScreenState = (allowed: readonly ScreenState[]): ScreenState | null => {
  const searchStr = useRouterState({ select: (state) => state.location.searchStr })
  if (!harnessEnabled) return null
  const values = new URLSearchParams(searchStr).getAll('state')
  return parseScreenState(values.length > 1 ? values : values[0], allowed)
}
