import type { StoreAction, StorePermission } from '../../api/stores'
import { fill, messages } from '../../messages'

const words = messages.stores

// Words for the API's refusal code. Whether the action is refused is the API's answer; this
// only says it in the console's words.
export const refusalText = (permission: StorePermission, action: StoreAction): string | null =>
  permission.allowed ? null : fill(words.refusals[permission.reason], { verb: words.verbs[action] })
