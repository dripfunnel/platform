import type { BillingRefusal } from '../../api/billing'
import { fill, messages } from '../../messages'

const words = messages.billing

// What the screen says after an answer, each refusal by its code (§16), so a provider that isn't
// switched on is never told to "try again".
export const modeToast = (result: { ok: true } | { ok: false; reason: BillingRefusal }, chosen: string): string =>
  result.ok ? fill(words.toasts.modeChanged, { mode: chosen }) : words.refusals[result.reason]

/** Null when the tab is on its way to the PDF and nothing needs saying. */
export const pdfToast = (result: { ok: true } | { ok: false; reason: BillingRefusal }, blocked: boolean): string | null =>
  !result.ok ? words.refusals[result.reason] : blocked ? words.toasts.popupBlocked : null
