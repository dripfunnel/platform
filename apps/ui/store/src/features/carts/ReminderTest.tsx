import { isApiError } from '@dripfunnel/shared/graphql'
import { ConfirmDialog } from '@dripfunnel/shared/ui'
import { useState } from 'react'
import { fill, messages } from '../../messages'
import { cartRefusal } from './cartActions'

// "Send me a test" beside a Reminders preview, the same for carts and wishlists (#321, #1645): the saved step goes to
// the person's own email, once a press, and the reason it can't is shown instead.

const words = messages.carts.reminders

interface Props {
  eyebrow: string
  /** Staff read the preview but have no button. */
  canEdit: boolean
  canUpgrade: boolean
  position: number
  /** Why a test can't go now (unsaved, locked by the plan, off); null when it can. */
  blocked: string | null
  /** What the dialog says it sends. */
  body: string
  email: string
  /** The harness's sample data: nothing is sent. */
  sample: boolean
  send: (position: number) => Promise<void>
  onSent: (message: string) => void
}

export const ReminderTest = ({ eyebrow, canEdit, canUpgrade, position, blocked, body, email, sample, send, onSent }: Props) => {
  const [testing, setTesting] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <>
      <div className="df-reminders-preview-head">
        <span className="df-eyebrow">{eyebrow}</span>
        {canEdit && (
          <button type="button" className="df-button" disabled={blocked !== null} aria-describedby={blocked ? 'df-reminders-test-note' : undefined} onClick={() => {
              setError(null)
              setTesting(true)
            }}>
            {words.test}
          </button>
        )}
      </div>
      {canEdit && blocked && (
        <span id="df-reminders-test-note" className="df-carts-sub">
          {blocked}
        </span>
      )}
      {testing && (
        <ConfirmDialog
          open
          title={fill(words.testTitle, { n: String(position) })}
          target={email}
          consequence={body}
          confirmLabel={words.testSend}
          cancelLabel={words.cancel}
          error={error}
          blocked={sending ? words.testSending : null}
          onConfirm={() => {
            if (sample) return setTesting(false)
            // One test per press: the dialog waits while one is on its way, so a double click sends one email.
            if (sending) return
            setSending(true)
            void send(position)
              .then(
                () => {
                  setTesting(false)
                  onSent(fill(words.testSent, { email }))
                },
                (failure: unknown) => setError(isApiError(failure, 'RATE_LIMITED') ? words.testTooMany : cartRefusal(failure, canUpgrade)),
              )
              .finally(() => setSending(false))
          }}
          onCancel={() => setTesting(false)}
        />
      )}
    </>
  )
}
