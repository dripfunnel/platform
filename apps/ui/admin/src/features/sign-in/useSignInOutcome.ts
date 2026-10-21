import { useRouterState } from '@tanstack/react-router'
import { parseScreenState } from '@dripfunnel/shared/ui'
import { signInOutcomes, type SignInOutcome } from './signInStates'

/** The real result of a sign-in attempt, so it is read whether or not the harness is on. */
export const useSignInOutcome = (): SignInOutcome | null => {
  const searchStr = useRouterState({ select: (state) => state.location.searchStr })
  return parseScreenState(new URLSearchParams(searchStr).get('outcome'), signInOutcomes)
}
