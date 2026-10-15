import { isApiError } from '../../graphql'
import { stateOfError } from '../common/useLoad'
import type { StateKind } from '../states/StateView'

/** The designed state a failed load draws (DESIGN.md §4): with no connection and no answer it is "offline", not "We couldn’t load". */
export const loadStateOf = (error: unknown, online: boolean): StateKind => (!online && isApiError(error, 'NO_RESPONSE') ? 'offline' : stateOfError(error))
