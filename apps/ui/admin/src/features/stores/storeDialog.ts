import type { Store, StoreAction } from '../../api/stores'
import { fill, formatDate, messages } from '../../messages'
import type { ConfirmDialogProps } from '../common/ConfirmDialog'

const words = messages.store

// Add note is written inline on the Notes tab (decided on #20); every other action confirms.
export type DialogAction = Exclude<StoreAction, 'addNote'>

export type StoreDialog = Pick<
  ConfirmDialogProps,
  'title' | 'target' | 'consequence' | 'confirmLabel' | 'notes' | 'reason' | 'typeToConfirm' | 'input' | 'danger'
>

const dayMs = 86_400_000
const isoDay = (iso: string) => iso.slice(0, 10)
const dayOf = (value: string) => formatDate(`${value}T00:00:00Z`)

// The new end defaults to the current end plus 14 days, and must fall after it (decided on #20).
const trialInput = (trialEndsAt: string): NonNullable<StoreDialog['input']> => {
  const currentEnd = isoDay(trialEndsAt)
  const spec = words.dialogs.extendTrial
  return {
    label: spec.input,
    type: 'date',
    initial: isoDay(new Date(Date.parse(trialEndsAt) + 14 * dayMs).toISOString()),
    error: (value) => (value === '' ? spec.pick : value > currentEnd ? null : fill(spec.tooEarly, { date: formatDate(trialEndsAt) })),
  }
}

const reasonField = (label: string, placeholder?: string, hint: string = words.reasonHint) => ({
  label,
  hint,
  ...(placeholder ? { placeholder } : {}),
})

const previousStatus = (store: Store) => messages.stores.statuses[store.state.kind === 'suspended' ? store.state.previous : 'active']

// What each confirmation says, in the prototype's words (designs/DF Admin Prototype.dc.html,
// the store cases of its dialog). Suspend and Restore name their reason. Retry and Undo are the
// signup job's, in provisioning/jobDialog.ts (decided on #43).
export const storeDialog = (action: DialogAction, store: Store): StoreDialog => {
  const values = {
    name: store.name,
    code: store.code,
    partner: store.partner.name,
    owner: store.owner.name,
    email: store.owner.email,
  }
  const base = { target: store.name, danger: false }
  switch (action) {
    case 'suspend': {
      const spec = words.dialogs.suspend
      const emergency = store.actions.suspend?.allowed === true && 'emergency' in store.actions.suspend
      return {
        ...base,
        title: fill(spec.title, values),
        consequence: fill(spec.consequence, values),
        confirmLabel: spec.confirm,
        notes: [...spec.notes.map((note) => fill(note, values)), ...(emergency ? [spec.emergency] : [])],
        reason: reasonField(spec.reason, spec.reasonPlaceholder, spec.reasonHint),
        typeToConfirm: { label: fill(spec.typeLabel, values), hint: spec.typeHint, expected: store.name },
        danger: true,
      }
    }
    case 'restore': {
      const spec = words.dialogs.restore
      return {
        ...base,
        title: fill(spec.title, values),
        consequence: fill(spec.consequence, { status: previousStatus(store) }),
        confirmLabel: spec.confirm,
        notes: spec.notes,
        reason: reasonField(spec.reason, spec.reasonPlaceholder),
      }
    }
    case 'extendTrial': {
      const spec = words.dialogs.extendTrial
      const trialEndsAt = store.state.kind === 'trial' ? store.state.trialEndsAt : store.createdAt
      return {
        ...base,
        title: fill(spec.title, values),
        consequence: (value) => fill(spec.consequence, { date: value ? dayOf(value) : spec.pending }),
        confirmLabel: spec.confirm,
        input: trialInput(trialEndsAt),
      }
    }
    case 'resendInvite': {
      const spec = words.dialogs.resendInvite
      return { ...base, title: spec.title, consequence: fill(spec.consequence, values), confirmLabel: spec.confirm }
    }
  }
}

export const storeToast = (action: StoreAction, store: Store, value: string | null) =>
  fill(words.toasts[action], {
    name: store.name,
    email: store.owner.email,
    status: previousStatus(store).toLowerCase(),
    date: value ? dayOf(value) : '',
  })
