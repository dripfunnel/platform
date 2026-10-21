import { isApiError } from '@dripfunnel/shared/graphql'
import { ConfirmDialog } from '@dripfunnel/shared/ui'
import { useState } from 'react'
import { z } from 'zod'
import { maxStopNote, remindNow, resumeReminders, stopReminders, type AbandonedCart } from '../../api/carts'
import { fill, messages } from '../../messages'

// "Send reminder now", "Stop reminders" and "Resume reminders" (Carts), from a row's actions and a cart's page alike.
// Each states what it does first; the API decides whether it may (one reminder a cart below the plan's automatic).

const words = messages.carts.act
const unlockSchema = z.object({ name: z.string() })

export const cartRefusal = (error: unknown, canUpgrade: boolean): string => {
  const refused = messages.carts.refused
  if (!isApiError(error)) return refused.other
  if (error.code === 'PLAN_LIMIT') {
    const plan = unlockSchema.safeParse(error.details['unlockedBy'])
    return canUpgrade && plan.success ? `${refused.PLAN_LIMIT} ${fill(refused.unlock, { plan: plan.data.name })}` : `${refused.PLAN_LIMIT} ${canUpgrade ? '' : refused.askOwner}`.trim()
  }
  return (refused as Record<string, string>)[error.code] ?? refused.other
}

type Asked = { act: 'send' | 'stop'; cart: AbandonedCart }

export const useCartActions = ({ sample, canUpgrade, codes, scheduled, onDone }: { sample: boolean; canUpgrade: boolean; codes: boolean; scheduled: boolean; onDone: (toast: string) => void }) => {
  const [asked, setAsked] = useState<Asked | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const run = async (work: () => Promise<void>, toast: string, fail: (m: string) => void) => {
    if (sample) {
      setAsked(null)
      return onDone(toast)
    }
    setBusy(true)
    try {
      await work()
      setAsked(null)
      onDone(toast)
    } catch (e) {
      fail(cartRefusal(e, canUpgrade))
    } finally {
      setBusy(false)
    }
  }

  const nameOf = (cart: AbandonedCart) => cart.name ?? cart.email ?? messages.carts.guest
  const start = (cart: AbandonedCart, act: 'send' | 'stop' | 'resume', fail: (m: string) => void) => {
    setError(null)
    if (act === 'resume') return void run(() => resumeReminders(cart.id), fill(words.resumed, { name: nameOf(cart) }), fail)
    setAsked({ act, cart })
  }
  const close = () => {
    setAsked(null)
    setError(null)
  }

  const dialog = asked ? (
    asked.act === 'send' ? (
      <ConfirmDialog
        open
        title={fill(words.sendTitle, { name: nameOf(asked.cart) })}
        target={asked.cart.email ?? ''}
        consequence={`${fill(words.sendBody, { email: asked.cart.email ?? '' })}${scheduled ? ` ${words.sendNext}` : ''}`}
        choices={
          codes
            ? [
                {
                  key: 'code',
                  label: words.codeLabel,
                  initial: '0',
                  options: [
                    { value: '0', label: words.noCode },
                    { value: '10', label: words.tenOff },
                  ],
                  error: () => null,
                },
              ]
            : []
        }
        confirmLabel={words.send}
        cancelLabel={words.cancel}
        blocked={busy ? words.working : null}
        error={error}
        onConfirm={(_, __, picks) => {
          const percent = picks['code'] === '10' ? 10 : null
          void run(() => remindNow(asked.cart.id, percent), fill(percent ? words.sentCode : words.sent, { email: asked.cart.email ?? '' }), setError)
        }}
        onCancel={close}
      />
    ) : (
      <ConfirmDialog
        open
        danger
        title={fill(words.stopTitle, { name: nameOf(asked.cart) })}
        target={nameOf(asked.cart)}
        consequence={words.stopBody}
        input={{ label: words.noteLabel, type: 'text', initial: '', placeholder: words.notePlaceholder, error: (v) => (v.trim().length > maxStopNote ? fill(words.noteLong, { max: String(maxStopNote) }) : null) }}
        confirmLabel={words.stop}
        cancelLabel={words.cancel}
        blocked={busy ? words.working : null}
        error={error}
        onConfirm={(_, note) => void run(() => stopReminders(asked.cart.id, note?.trim() || null), fill(words.stopped, { name: nameOf(asked.cart) }), setError)}
        onCancel={close}
      />
    )
  ) : null

  return { start, dialog, busy }
}
