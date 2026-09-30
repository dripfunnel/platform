import type { JobAction } from '../../api/provisioning'
import type { ProvisioningStep } from '../../api/provisioningSteps'
import { fill, messages } from '../../messages'
import type { ConfirmDialogProps } from '../common/ConfirmDialog'

const words = messages.provisioning

export type JobDialog = Pick<ConfirmDialogProps, 'title' | 'target' | 'consequence' | 'confirmLabel' | 'notes' | 'reason' | 'typeToConfirm' | 'input' | 'danger'>

// What a Retry or Undo is about, whether it is asked for from the Provisioning list or the
// store's own tab: the one dialog for both (decided on #43).
export interface JobTarget {
  name: string
  code: string
  owner: { name: string }
  step: ProvisioningStep
  attempts: number
}

// The prototype's words for the two confirmations. Undo is destructive, names what it removes,
// says it can't be undone and wants the store code typed; like every console write it also
// asks for a reason (decided on #20).
export const jobDialog = (action: JobAction, target: JobTarget): JobDialog => {
  const values = { name: target.name, code: target.code, owner: target.owner.name, step: words.steps[target.step], next: String(target.attempts + 1) }
  switch (action) {
    case 'retry': {
      const spec = words.dialogs.retry
      return {
        title: fill(spec.title, values),
        target: target.name,
        consequence: fill(spec.consequence, values),
        confirmLabel: fill(spec.confirm, values),
        notes: spec.notes.map((note) => fill(note, values)),
        danger: false,
      }
    }
    case 'undo': {
      const spec = words.dialogs.undo
      return {
        title: fill(spec.title, values),
        target: target.name,
        consequence: fill(spec.consequence, values),
        confirmLabel: spec.confirm,
        notes: spec.notes,
        reason: { label: spec.reason, hint: words.reasonHint },
        typeToConfirm: { label: fill(spec.typeLabel, values), hint: spec.typeHint, expected: target.code },
        danger: true,
      }
    }
  }
}
