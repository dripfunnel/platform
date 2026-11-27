import type { BillingRefusal } from '../../api/billing'
import { messages } from '../../messages'

const words = messages.billing

/** Null when the tab is on its way to the PDF and nothing needs saying; a refusal by its code (§16). */
export const pdfToast = (result: { ok: true } | { ok: false; reason: BillingRefusal }, blocked: boolean): string | null =>
  !result.ok ? words.refusals[result.reason] : blocked ? words.toasts.popupBlocked : null
