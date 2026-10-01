import type { Partner, PartnerAction } from '../../api/partners'
import { fill, formatCount, messages } from '../../messages'
import type { ConfirmDialogProps } from '../common/ConfirmDialog'

const words = messages.partner

type DialogWords = {
  title: string
  consequence: string
  confirm: string
  notes?: readonly string[]
  reason?: string
  reasonHint?: string
}

// Every action but the setup session, which has its own flow (features/impersonate).
export type ConfirmedAction = Exclude<PartnerAction, 'setupSession'>

export type ActionDialog = Pick<ConfirmDialogProps, 'title' | 'target' | 'consequence' | 'confirmLabel' | 'notes' | 'reason' | 'danger'>

// What each confirmation says (FIRST-RELEASE.md §4.3, in the prototype's words). Every action
// that changes the partner's business asks for a reason (decided on #19); nothing here is
// irreversible, so none asks for the name typed.
export const actionDialog = (action: ConfirmedAction, partner: Partner): ActionDialog => {
  const spec: DialogWords = words.dialogs[action]
  const values = {
    name: partner.name,
    host: partner.portalHost.host ?? '',
    count: formatCount(partner.stores),
    email: partner.owner.email,
  }
  return {
    title: fill(spec.title, values),
    target: partner.name,
    consequence: fill(spec.consequence, values),
    confirmLabel: fill(spec.confirm, values),
    ...(spec.notes ? { notes: spec.notes.map((note) => fill(note, values)) } : {}),
    ...(spec.reason ? { reason: { label: spec.reason, hint: spec.reasonHint ?? words.reasonHint } } : {}),
    danger: action === 'pause',
  }
}

export const actionToast = (action: ConfirmedAction, partner: Partner) =>
  fill(words.toasts[action], { name: partner.name, host: partner.portalHost.host ?? '', email: partner.owner.email })
