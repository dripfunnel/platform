import { useCallback, useState } from 'react'
import { errorMessage, type ErrorContext } from '../../messages/errorMessage'
import { useFeedback } from '../shell/Feedback'

/**
 * One card's writes: `busy` while one runs, the refusal in words (by its code) on the card until the next try, and a toast saying what
 * was saved. Resolves true when it saved, so a card moves its saved line only then. The server decides every write again.
 */
export function useWrite(context: ErrorContext) {
  const feedback = useFeedback()
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const run = useCallback(
    async (work: () => Promise<string>): Promise<boolean> => {
      setBusy(true)
      setFailure(null)
      try {
        feedback.toast({ message: await work() })
        return true
      } catch (error) {
        setFailure(errorMessage(error, context))
        return false
      } finally {
        setBusy(false)
      }
    },
    [context, feedback],
  )

  return { busy, failure, run, clear: useCallback(() => setFailure(null), []) }
}
