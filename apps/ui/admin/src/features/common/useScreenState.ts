import { useRouterState } from '@tanstack/react-router'
import { isHarnessEnabled, parseScreenState } from '@dripfunnel/shared/ui'

export const harnessEnabled = isHarnessEnabled(import.meta.env)

export const useScreenState = <State extends string>(allowed: readonly State[]): State | null => {
  const searchStr = useRouterState({ select: (state) => state.location.searchStr })
  if (!harnessEnabled) return null
  const values = new URLSearchParams(searchStr).getAll('state')
  return parseScreenState(values.length > 1 ? values : values[0], allowed)
}
