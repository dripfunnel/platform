import type { ConfirmDialogProps } from '@dripfunnel/shared/ui'
import type { PlanEditor, RetireInput } from '../../api/plans'
import { fill, formatCount, formatDate, messages, plural } from '../../messages'

export type PlanDialog = Pick<ConfirmDialogProps, 'title' | 'target' | 'consequence' | 'confirmLabel' | 'choices' | 'danger'>

const words = messages.plans.dialogs

// Saving a plan stores are on asks who gets the change (SAAS.md §6.3, FIRST-RELEASE.md §7.3).
export const saveDialog = (name: string, stores: number): PlanDialog => {
  const spec = words.save
  if (stores === 0) return { title: fill(spec.title, { plan: name }), target: name, consequence: spec.consequence, confirmLabel: spec.confirm }
  return {
    title: fill(plural(spec.titleStores, stores), { count: formatCount(stores), plan: name }),
    target: name,
    consequence: spec.consequenceStores,
    confirmLabel: spec.confirm,
    choices: [
      {
        key: 'who',
        label: spec.who,
        options: [
          { value: 'new', label: spec.new },
          { value: 'renewal', label: spec.renewal },
        ],
        initial: 'new',
        error: () => null,
      },
    ],
  }
}

// Retiring hides the plan from signup; its stores keep it or move to another Live plan on a date (§7.3).
export const retireDialog = (name: string, stores: number, editor: PlanEditor): PlanDialog => {
  const spec = words.retire
  const base = { title: fill(spec.title, { plan: name }), target: name, confirmLabel: spec.confirm, danger: true }
  if (stores === 0) return { ...base, consequence: fill(spec.consequence, { plan: name }) }
  return {
    ...base,
    consequence: fill(plural(spec.consequenceStores, stores), { plan: name, count: formatCount(stores) }),
    choices: [
      {
        key: 'keep',
        label: spec.storesOn,
        options: [
          { value: 'keep', label: fill(spec.keep, { plan: name }) },
          { value: 'move', label: spec.move },
        ],
        initial: 'keep',
        error: () => null,
      },
      {
        key: 'moveTo',
        label: spec.moveTo,
        options: [{ value: '', label: spec.choose }, ...editor.retireTargets.map((target) => ({ value: target.id, label: target.name }))],
        initial: '',
        error: (picked) => (picked === '' ? spec.choose : null),
        when: (all) => all.keep === 'move',
      },
      {
        key: 'on',
        label: spec.on,
        options: [{ value: '', label: spec.choose }, ...editor.retireDates.map((date) => ({ value: date, label: formatDate(date) }))],
        initial: '',
        error: (picked) => (picked === '' ? spec.choose : null),
        when: (all) => all.keep === 'move',
      },
    ],
  }
}

// The dialog only confirms a complete move, so an incomplete one never reaches here.
export const retireInput = (picks: Readonly<Record<string, string>>): RetireInput | null =>
  picks.keep === 'move' ? (picks.moveTo && picks.on ? { keep: false, moveTo: picks.moveTo, on: picks.on } : null) : { keep: true }
