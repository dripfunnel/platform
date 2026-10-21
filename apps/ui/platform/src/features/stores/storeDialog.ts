import type { ConfirmChoice, ConfirmDialogProps } from '@dripfunnel/shared/ui'
import type { ChangePlanOptions, LimitKey, Store, StoreAction, StoreActionInput } from '../../api/stores'
import { fill, formatAmount, formatCount, formatDate, messages } from '../../messages'
import { chargedByOf, planNameOf } from './storeLook'

const words = messages.store.dialogs

export type StoreDialog = Pick<ConfirmDialogProps, 'title' | 'target' | 'consequence' | 'confirmLabel' | 'notes' | 'reason' | 'typeToConfirm' | 'input' | 'choices' | 'danger'>

const reasonField = (label = messages.store.reason, hint = messages.store.reasonHint) => ({ label, hint, placeholder: messages.store.reasonPlaceholder })

const limits: readonly LimitKey[] = ['products', 'staff', 'suppliers', 'ai', 'publish']

// What each confirmation says before the confirm (FIRST-RELEASE.md §6.4), in the prototype's words.
// `options` is the API's answer for Change plan: the plans offered, the next billing date, the proration.
export const storeDialog = (action: StoreAction, store: Store, options: ChangePlanOptions | null): StoreDialog => {
  const values = { name: store.name, owner: store.owner.name, email: store.owner.email, who: chargedByOf(store.billing.mode, store.billing.partnerName) }
  const base = { target: store.name, danger: false }
  switch (action) {
    case 'changePlan': {
      const spec = words.changePlan
      const plans = options?.plans ?? []
      const planChoice: ConfirmChoice = {
        key: 'planId',
        label: spec.plan,
        options: [{ value: '', label: spec.choose }, ...plans.map((plan) => ({ value: plan.id, label: fill(spec.planOption, { plan: plan.name, price: formatAmount(plan.price) }) }))],
        initial: '',
        error: (picked) => (picked === '' ? spec.pick : null),
      }
      return {
        ...base,
        title: fill(spec.title, values),
        consequence: (_value, picks) => {
          const to = plans.find((plan) => plan.id === picks.planId)
          if (!to) return spec.pick
          const moved = fill(spec.consequence, { ...values, from: planNameOf(store.plan), fromPrice: store.planPrice ? formatAmount(store.planPrice) : '', to: to.name, toPrice: formatAmount(to.price) })
          const proration = options?.proration[to.id]
          if (picks.when !== 'now' || !proration || proration.kind === 'none') return moved
          return `${moved} ${proration.kind === 'charge' ? fill(spec.chargedToday, { amount: formatAmount(proration.amount) }) : spec.credited}`
        },
        confirmLabel: spec.confirm,
        choices: [
          planChoice,
          {
            key: 'when',
            label: spec.when,
            options: [
              { value: 'next', label: fill(spec.next, { date: options?.nextBillingAt ? formatDate(options.nextBillingAt) : '' }) },
              { value: 'now', label: spec.now },
            ],
            initial: 'next',
            error: () => null,
          },
        ],
        reason: reasonField(),
      }
    }
    case 'extendTrial': {
      const spec = words.extendTrial
      const from = store.state.kind === 'trial' && store.state.trialEndsAt ? formatDate(store.state.trialEndsAt) : ''
      return {
        ...base,
        title: fill(spec.title, values),
        consequence: (_value, picks) => {
          const extension = store.trialExtensions.find((candidate) => String(candidate.days) === picks.days)
          return extension ? fill(spec.consequence, { from, to: formatDate(extension.endsAt) }) : fill(spec.pick, { from })
        },
        confirmLabel: spec.confirm,
        choices: [
          {
            key: 'days',
            label: spec.add,
            options: [{ value: '', label: spec.choose }, ...store.trialExtensions.map(({ days }) => ({ value: String(days), label: fill(spec.days, { count: formatCount(days) }) }))],
            initial: '',
            error: (picked) => (picked === '' ? spec.choose : null),
          },
        ],
        reason: reasonField(),
      }
    }
    case 'addOverride': {
      const spec = words.addOverride
      return {
        ...base,
        title: fill(spec.title, values),
        consequence: (value, picks) => {
          const amount = Number(value)
          const limit = limits.find((candidate) => candidate === picks.limit)
          if (!limit || !(amount > 0)) return spec.pick
          return fill(spec.consequence, { ...values, amount: formatCount(amount), limit: messages.store.plan.limits[limit].toLowerCase(), duration: picks.duration === 'always' ? spec.always : spec.month })
        },
        confirmLabel: spec.confirm,
        choices: [
          {
            key: 'limit',
            label: spec.limit,
            options: [{ value: '', label: spec.choose }, ...limits.map((limit) => ({ value: limit, label: messages.store.plan.limits[limit] }))],
            initial: '',
            error: (picked) => (picked === '' ? spec.choose : null),
          },
          {
            key: 'duration',
            label: spec.for,
            options: [
              { value: 'month', label: spec.forMonth },
              { value: 'always', label: spec.forAlways },
            ],
            initial: 'month',
            error: () => null,
          },
        ],
        input: { label: spec.amount, type: 'text', initial: '', placeholder: '10', error: (value) => (/^[1-9]\d{0,5}$/.test(value.trim()) ? null : spec.amountError) },
        reason: reasonField(),
      }
    }
    case 'suspend': {
      const spec = words.suspend
      return {
        ...base,
        title: fill(spec.title, values),
        consequence: fill(spec.consequence, { owner: store.owner.name.split(' ')[0] ?? store.owner.name }),
        confirmLabel: spec.confirm,
        reason: reasonField(spec.reason, spec.reasonHint),
        typeToConfirm: { label: spec.typeLabel, hint: fill(spec.typeHint, values), expected: store.name },
        danger: true,
      }
    }
    case 'restore': {
      const spec = words.restore
      return { ...base, title: fill(spec.title, values), consequence: spec.consequence, confirmLabel: spec.confirm, reason: reasonField() }
    }
    case 'resendInvite': {
      const spec = words.resendInvite
      return { ...base, title: spec.title, consequence: fill(spec.consequence, values), confirmLabel: spec.confirm }
    }
    case 'retryStep': {
      const spec = words.retryStep
      const step = store.setup.steps.find((candidate) => candidate.state === 'slow' || candidate.state === 'failed')
      return { ...base, title: fill(spec.title, { step: step ? messages.store.setup.steps[step.key] : '' }), consequence: spec.consequence, confirmLabel: spec.confirm }
    }
  }
}

// The dialog's answers as the API's input; null when they don't make one (the dialog never lets that through).
export const actionInput = (action: StoreAction, reason: string | null, value: string | null, picks: Readonly<Record<string, string>>): StoreActionInput | null => {
  switch (action) {
    case 'changePlan':
      return picks.planId && (picks.when === 'next' || picks.when === 'now') && reason ? { action, planId: picks.planId, when: picks.when, reason } : null
    case 'extendTrial':
      return Number(picks.days) > 0 && reason ? { action, days: Number(picks.days), reason } : null
    case 'addOverride': {
      const limit = limits.find((candidate) => candidate === picks.limit)
      return limit && Number(value) > 0 && (picks.duration === 'month' || picks.duration === 'always') && reason ? { action, limit, amount: Number(value), duration: picks.duration, reason } : null
    }
    case 'suspend':
    case 'restore':
      return reason ? { action, reason } : null
    case 'resendInvite':
    case 'retryStep':
      return { action }
  }
}

export const storeToast = (input: StoreActionInput, store: Store, options: ChangePlanOptions | null): string => {
  const words = messages.store.toasts
  switch (input.action) {
    case 'changePlan': {
      const plan = options?.plans.find((candidate) => candidate.id === input.planId)?.name ?? input.planId
      return input.when === 'now' ? fill(words.changePlanNow, { name: store.name, plan }) : fill(words.changePlanNext, { name: store.name, plan, date: options?.nextBillingAt ? formatDate(options.nextBillingAt) : '' })
    }
    case 'extendTrial':
      return fill(words.extendTrial, { date: formatDate(store.trialExtensions.find((candidate) => candidate.days === input.days)?.endsAt ?? '') })
    case 'addOverride':
      return words.addOverride
    case 'suspend':
      return fill(words.suspend, { name: store.name })
    case 'restore':
      return fill(words.restore, { name: store.name })
    case 'resendInvite':
      return fill(words.resendInvite, { email: store.owner.email })
    case 'retryStep':
      return fill(words.retryStep, { name: store.name })
  }
}
