import { ConfirmDialog } from '@dripfunnel/shared/ui'
import { useState } from 'react'
import { maxStopNote } from '../../api/carts'
import { remindWishlistNow, resumeWishlistReminders, stopWishlistReminders, type WishlistShopper } from '../../api/wishlists'
import { fill, messages } from '../../messages'
import { cartRefusal } from './cartActions'

// "Send reminder now", "Stop reminders" and "Resume reminders" (Wishlists), from a row's menu and a shopper's page alike.
// Each states what it does first; the API decides whether it may (one reminder a wishlist below the plan's automatic).

const words = messages.carts.wishlists.act
const noteWords = messages.carts.act

type Asked = { act: 'send' | 'stop'; shopper: WishlistShopper }

export const useWishlistActions = ({ sample, canUpgrade, onDone }: { sample: boolean; canUpgrade: boolean; onDone: (toast: string) => void }) => {
  const [asked, setAsked] = useState<Asked | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const run = (work: () => Promise<void>, toast: string, fail: (m: string) => void) => {
    if (sample) {
      setAsked(null)
      return onDone(toast)
    }
    setBusy(true)
    void work()
      .then(() => {
        setAsked(null)
        onDone(toast)
      })
      .catch((e: unknown) => fail(cartRefusal(e, canUpgrade)))
      .finally(() => setBusy(false))
  }

  const nameOf = (s: WishlistShopper) => s.name ?? s.email ?? messages.carts.guest
  const start = (shopper: WishlistShopper, act: 'send' | 'stop' | 'resume', fail: (m: string) => void) => {
    setError(null)
    if (act === 'resume') return run(() => resumeWishlistReminders(shopper.customerId), fill(words.resumed, { name: nameOf(shopper) }), fail)
    setAsked({ act, shopper })
  }

  const dialog = asked ? (
    asked.act === 'send' ? (
      <ConfirmDialog
        open
        title={fill(words.sendTitle, { name: nameOf(asked.shopper) })}
        target={asked.shopper.email ?? ''}
        consequence={`${fill(words.sendBody, { email: asked.shopper.email ?? '' })} ${words.sendNext}`}
        confirmLabel={words.sendConfirm}
        cancelLabel={words.cancel}
        blocked={busy ? words.working : null}
        error={error}
        onConfirm={() => run(() => remindWishlistNow(asked.shopper.customerId), fill(words.sent, { email: asked.shopper.email ?? '' }), setError)}
        onCancel={() => setAsked(null)}
      />
    ) : (
      <ConfirmDialog
        open
        danger
        title={fill(words.stopTitle, { name: nameOf(asked.shopper) })}
        target={nameOf(asked.shopper)}
        consequence={words.stopBody}
        input={{ label: noteWords.noteLabel, type: 'text', initial: '', placeholder: noteWords.notePlaceholder, error: (v) => (v.trim().length > maxStopNote ? fill(noteWords.noteLong, { max: String(maxStopNote) }) : null) }}
        confirmLabel={words.stop}
        cancelLabel={words.cancel}
        blocked={busy ? words.working : null}
        error={error}
        onConfirm={(_, note) => run(() => stopWishlistReminders(asked.shopper.customerId, note?.trim() || null), fill(words.stopped, { name: nameOf(asked.shopper) }), setError)}
        onCancel={() => setAsked(null)}
      />
    )
  ) : null

  return { start, dialog, busy }
}
