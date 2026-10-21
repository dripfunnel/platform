import type { StoreState } from '../../api/shell'
import { formatDuration, formatNumber } from '../../format'
import { locale, t } from '../../messages'
import type { Seat } from '../../nav'
import type { BannerScenario } from '../states/scenario'

export type BannerTone = 'info' | 'warning' | 'danger' | 'success' | 'offline'
/** Support asking to make changes for this one session; an Owner or a Manager answers Allow or Deny (ACCESS.md §8). */
export type SupportAsk = { sessionId: string; agent: string; partner: string; note: string | null }

export type BannerSpec = { key: string; tone: BannerTone; title: string; body: string; ask?: SupportAsk }

const day = 24 * 60 * 60 * 1000

/** Whole days left in a trial, today's counted; null when the store isn't in one. */
export const trialDaysLeft = (trialEndsAt: string | null, now: Date): number | null =>
  trialEndsAt === null ? null : Math.max(0, Math.ceil((new Date(trialEndsAt).getTime() - now.getTime()) / day))

type Inputs = { seat: Seat | null; state: StoreState | null; support: string | null; online: boolean; scenario: BannerScenario; now: Date }

const said = (key: string, tone: BannerTone, title: string, body: string): BannerSpec => ({ key, tone, title, body })

// Plan banners carry no button in the app: billing isn't in it (FIRST-RELEASE.md §1). The wording is the portal's.
const forScenario = (scenario: Exclude<BannerScenario, 'real' | 'none'>): BannerSpec => {
  switch (scenario) {
    case 'provisioning':
      return said('provisioning', 'info', t('banners.provisioning.title'), t('banners.provisioning.body'))
    case 'pastDue':
      return said('pastDue', 'warning', t('banners.pastDue.title'), t('banners.pastDue.body'))
    case 'trial':
      return said('trial', 'info', t('banners.trial.title', { days: t('banners.trial.days', { count: formatNumber(3, locale) }) }), t('banners.trial.body'))
    case 'trialEnds':
      return said('trialEnding', 'warning', t('banners.trialEnding.title'), t('banners.trialEnding.body'))
    case 'trialEnded':
      return said('trialEnded', 'warning', t('banners.trialEnded.title'), t('banners.trialEnded.body'))
    case 'bandwidth':
      return said('bandwidth', 'warning', t('banners.bandwidth.title', { percent: formatNumber(85, locale) }), t('banners.bandwidth.body'))
    case 'whiteLabel':
      return said('whiteLabel', 'success', t('banners.whiteLabel.title'), t('banners.whiteLabel.body'))
    case 'support':
      return said('support', 'warning', t('banners.support.title', { partner: t('banners.sample.partner'), name: t('banners.sample.agent') }), t('banners.support.body', { time: formatDuration(25 * 60, locale) }))
    case 'offline':
      return offline()
  }
}

const offline = (): BannerSpec => said('offline', 'offline', t('banners.offline.title'), t('banners.offline.body'))

/** The shell's banners (FIRST-RELEASE.md §3.3) in the portal's order. A supplier is sent no plan, trial or billing state. */
export const bannersFor = ({ seat, state, support, online, scenario, now }: Inputs): readonly BannerSpec[] => {
  if (scenario === 'none') return []
  if (scenario !== 'real') return [forScenario(scenario)]

  const owner = seat?.side === 'merchant' && seat.role === 'owner'
  const days = state?.status === 'trial' ? trialDaysLeft(state.trialEndsAt, now) : null
  const banners: BannerSpec[] = []
  if (state?.provisioning) banners.push(forScenario('provisioning'))
  if (state?.status === 'past_due') banners.push(forScenario('pastDue'))
  if (owner && days !== null && days > 1) banners.push(said('trial', 'info', t('banners.trial.title', { days: t('banners.trial.days', { count: formatNumber(days, locale) }) }), t('banners.trial.body')))
  if (owner && days !== null && days <= 1) banners.push(forScenario('trialEnds'))
  if (state?.status === 'suspended') {
    const contact = support ? t('banners.suspended.contact', { support }) : t('banners.suspended.noContact')
    banners.push(said('suspended', 'danger', t('banners.suspended.title'), t('banners.suspended.body', { contact })))
  }
  if (state?.status === 'cancelled') banners.push(said('cancelled', 'warning', t('banners.cancelled.title'), t('banners.cancelled.body')))
  if (state?.support) {
    const { partnerName, agentFirstName, endsAt, sessionId, access, writeRequest } = state.support
    const seconds = Math.max(0, Math.round((new Date(endsAt).getTime() - now.getTime()) / 1000))
    const time = formatDuration(seconds, locale)
    const asking = writeRequest?.state === 'pending' && sessionId !== null
    const spec = said('support', 'warning', t('banners.support.title', { partner: partnerName, name: agentFirstName }), t(access === 'write' ? 'banners.support.bodyWrite' : 'banners.support.body', { time }))
    banners.push(asking ? { ...spec, ask: { sessionId, agent: agentFirstName, partner: partnerName, note: writeRequest.note } } : spec)
  }
  if (!online) banners.push(offline())
  return banners
}
