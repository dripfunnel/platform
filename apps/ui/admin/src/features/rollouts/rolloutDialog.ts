import type { ConfirmChoice, ConfirmDialogProps } from '@dripfunnel/shared/ui'
import { isApiError } from '../../api/client'
import { rolloutRefusals, type Rollout, type RolloutAction, type RolloutRefusal } from '../../api/rollouts'
import { fill, messages } from '../../messages'

const words = messages.rollouts
const dialogs = words.dialogs

export type RolloutDialog = Pick<ConfirmDialogProps, 'title' | 'target' | 'consequence' | 'confirmLabel' | 'reason' | 'danger'> & {
  input?: ConfirmDialogProps['input']
  choices?: readonly ConfirmChoice[]
}

export type DialogFor = { kind: 'steer'; action: RolloutAction; rollout: Pick<Rollout, 'id' | 'version'> } | { kind: 'start' }

const reason = { label: dialogs.reason.label, hint: dialogs.reason.hint }
const versionPattern = /^\d+\.\d+\.\d+$/

export const securityChoice = 'security'

export const rolloutDialog = (target: DialogFor): RolloutDialog => {
  if (target.kind === 'start') {
    const start = dialogs.start
    return {
      title: start.title,
      target: start.target,
      consequence: start.consequence,
      confirmLabel: start.confirm,
      reason,
      input: { label: start.version, type: 'text', initial: '', placeholder: start.versionPlaceholder, error: (v) => (versionPattern.test(v.trim()) ? null : start.versionError) },
      choices: [
        {
          key: securityChoice,
          label: start.kind,
          options: [
            { value: 'upgrade', label: start.kinds.upgrade },
            { value: 'security', label: start.kinds.security },
          ],
          initial: 'upgrade',
          error: () => null,
        },
      ],
    }
  }
  const words = dialogs[target.action]
  const version = target.rollout.version
  return {
    title: fill(words.title, { version }),
    target: fill(dialogs.target, { version }),
    consequence: fill(words.consequence, { version }),
    confirmLabel: words.confirm,
    reason,
    danger: target.action === 'rollBack',
  }
}

// A refusal in the console's words; ROLLOUT_ACTIVE names the rollout in the way when the page knows it.
export const refusalWords = (error: unknown, blocking: Pick<Rollout, 'version'> | null = null): string => {
  if (!isApiError(error) || !(rolloutRefusals as readonly string[]).includes(error.code)) return words.refusals.other
  const code = error.code as RolloutRefusal
  return code === 'ROLLOUT_ACTIVE' && blocking ? fill(words.refusals.ROLLOUT_ACTIVE_NAMED, { version: blocking.version }) : words.refusals[code]
}
