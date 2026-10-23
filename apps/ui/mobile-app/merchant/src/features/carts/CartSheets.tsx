import type { AbandonedCart } from '../../api/carts'
import type { ApiClient } from '@dripfunnel/mobile-shared/graphql'
import type { CartAction } from './CartCard'
import { ResumeRemindersSheet } from './ResumeRemindersSheet'
import { SendReminderSheet } from './SendReminderSheet'
import { StopRemindersSheet } from './StopRemindersSheet'

export type CartSheet = { act: CartAction; cart: AbandonedCart }

type Props = { sheet: CartSheet | null; client: ApiClient; codes: boolean; scheduled: boolean; onClose: () => void; onDone: () => void }

// The sheet for the action a cart's card or page asked for; each says what it does first and keeps a refusal, by its code, until closed.
export function CartSheets({ sheet, client, codes, scheduled, onClose, onDone }: Props) {
  if (!sheet) return null
  if (sheet.act === 'send') return <SendReminderSheet client={client} cart={sheet.cart} codes={codes} scheduled={scheduled} onClose={onClose} onDone={onDone} />
  if (sheet.act === 'stop') return <StopRemindersSheet client={client} cart={sheet.cart} onClose={onClose} onDone={onDone} />
  return <ResumeRemindersSheet client={client} cart={sheet.cart} onClose={onClose} onDone={onDone} />
}
