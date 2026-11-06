import { StatusPill, type StatusIconName, type StatusTone } from '@dripfunnel/shared/ui'
import type { Rollout, RolloutState, StoreUpgradeState } from '../../api/rollouts'
import { fill, formatCount, messages } from '../../messages'

const words = messages.rollouts

const rolloutLook: Record<RolloutState, { tone: StatusTone; icon: StatusIconName }> = {
  canary: { tone: 'info', icon: 'hour' },
  waves: { tone: 'info', icon: 'hour' },
  paused: { tone: 'warning', icon: 'pause' },
  done: { tone: 'success', icon: 'ok' },
  rolled_back: { tone: 'neutral', icon: 'ban' },
}

const storeLook: Record<StoreUpgradeState, { tone: StatusTone; icon: StatusIconName }> = {
  pending: { tone: 'neutral', icon: 'clock' },
  running: { tone: 'info', icon: 'hour' },
  passed: { tone: 'success', icon: 'ok' },
  migrated: { tone: 'success', icon: 'pen' },
  pinned: { tone: 'danger', icon: 'alert' },
  baseline: { tone: 'warning', icon: 'shield' },
  live: { tone: 'success', icon: 'ok' },
  reverted: { tone: 'neutral', icon: 'ban' },
}

export const rolloutStateLabel = (rollout: Pick<Rollout, 'state' | 'percent'>): string =>
  rollout.state === 'waves' ? fill(words.wavesAt, { percent: formatCount(rollout.percent) }) : words.states[rollout.state]

export const RolloutStatePill = ({ rollout }: { rollout: Pick<Rollout, 'state' | 'percent'> }) => <StatusPill {...rolloutLook[rollout.state]} label={rolloutStateLabel(rollout)} />

export const StoreStatePill = ({ state }: { state: StoreUpgradeState }) => <StatusPill {...storeLook[state]} label={words.storeStates[state]} />

// The codes the upgrade Workflow writes (apps/api saas/fleet/upgrade.ts); a build's own codes pass through as they are.
export const errorText = (code: string): string => (code in words.errors && code !== 'other' ? words.errors[code as keyof typeof words.errors] : fill(words.errors.other, { code }))

export const storeCounts = (rollout: Pick<Rollout, 'stores'>): string =>
  rollout.stores.length === 0
    ? words.noStores
    : rollout.stores.map((c) => fill(words.storeCount, { count: formatCount(c.count), state: words.storeStates[c.state].toLowerCase() })).join(' · ')
