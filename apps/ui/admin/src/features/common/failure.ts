import { isApiError } from '../../api/client'
import { messages } from '../../messages'

const words = messages.common.failures

const isWorded = (code: string): code is keyof typeof words => code in words

// A failed write, worded by the API's stable code (ui/README.md §3), or the screen's own
// fallback when the code has no words yet. Never the error's message: it can carry internals.
export const failureText = (error: unknown, fallback: string): string =>
  isApiError(error) && isWorded(error.code) ? words[error.code] : fallback
