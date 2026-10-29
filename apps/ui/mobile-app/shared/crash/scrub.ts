import { isApiError } from '../graphql'

/** What a report says about a failure: the API's code, else the error's class. Never its message, which can carry anything a person typed or a server said. */
const labelOf = (error: unknown): string => (isApiError(error) ? error.code : error instanceof Error ? error.name : typeof error)

/** Only the frames of a stack, which name the code that failed and hold no values. */
const framesOf = (error: unknown): string => (error instanceof Error && error.stack ? error.stack.split('\n').filter((line) => /^\s+at /.test(line)).join('\n') : '')

/** The error a report is made from: the same class and frames, with the message replaced by what `labelOf` says (shop/ARCHITECTURE.md §2, crash reporting). */
export const scrubbed = (error: unknown): Error => {
  const label = labelOf(error)
  const clean = new Error(label)
  clean.name = error instanceof Error ? error.name : 'Error'
  clean.stack = `${clean.name}: ${label}\n${framesOf(error)}`
  return clean
}
