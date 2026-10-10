import { Strip, useNow } from '@dripfunnel/shared/ui'
import { Link, useRouterState } from '@tanstack/react-router'
import type { Brand } from '../../api/brand'
import type { Acting, StoreState } from '../../api/shell'
import { fill, formatCount, formatWait, messages, plural } from '../../messages'
import type { Seat } from '../../nav'
import { useOnline } from '../common/online'
import { isRunning, useImportRun } from '../imports/importRun'
import { trialDaysLeft } from './trial'

const words = messages.shell.banners

const Said = ({ title, body }: { title: string; body: string }) => (
  <>
    <strong>{title}</strong> {body}
  </>
)

// The shell's banners (FIRST-RELEASE.md §3.3) in the prototype's order and words. A supplier never
// sees plan, trial or billing state (§19): the API sends it none.
export const StoreBanners = ({ seat, acting, state, brand }: { seat: Seat; acting: Acting; state: StoreState | null; brand: Brand | null }) => {
  const online = useOnline()
  const now = new Date(useNow(60_000))
  const owner = seat.side === 'merchant' && seat.role === 'owner'
  const days = state?.status === 'trial' ? trialDaysLeft(state.trialEndsAt, now) : null
  const support = brand?.supportEmail ?? brand?.supportUrl ?? null
  const run = useImportRun()
  const onImports = useRouterState({ select: (r) => r.location.pathname === '/products/import' })
  const importing = isRunning(run) && !onImports ? run : null
  return (
    <>
      {state?.provisioning && (
        <Strip tone="info">
          <Said title={words.provisioning.title} body={words.provisioning.body} />
        </Strip>
      )}
      {state?.status === 'past_due' && (
        <Strip tone="warning" action={owner ? <Link className="df-strip-button" to="/billing">{words.pastDue.action}</Link> : undefined}>
          <Said title={words.pastDue.title} body={words.pastDue.body} />
        </Strip>
      )}
      {owner && days !== null && days > 1 && (
        <Strip tone="info" action={<Link className="df-strip-button" to="/billing">{words.trial.action}</Link>}>
          <Said title={fill(words.trial.title, { days: fill(plural(messages.shell.trialNote, days), { count: formatCount(days) }) })} body={fill(words.trial.body, { plan: acting.plan?.name ?? '' })} />
        </Strip>
      )}
      {owner && days !== null && days <= 1 && (
        <Strip tone="warning" action={<Link className="df-strip-button" to="/billing/keep">{words.trialEnding.action}</Link>}>
          <Said title={words.trialEnding.title} body={words.trialEnding.body} />
        </Strip>
      )}
      {state?.status === 'suspended' && (
        <Strip tone="danger">
          <Said title={words.suspended.title} body={fill(words.suspended.body, { contact: support ? fill(words.suspended.contact, { support }) : words.suspended.noContact })} />
        </Strip>
      )}
      {state?.status === 'cancelled' && (
        <Strip tone="warning">
          <Said title={words.cancelled.title} body={words.cancelled.body} />
        </Strip>
      )}
      {state?.support && (
        <Strip tone="warning">
          <Said
            title={fill(words.support.title, { partner: state.support.partnerName, name: state.support.agentFirstName })}
            body={fill(words.support.body, { time: formatWait(Math.max(0, Math.round((new Date(state.support.endsAt).getTime() - now.getTime()) / 1000))) })}
          />
        </Strip>
      )}
      {importing && (
        <Strip tone="info" action={<Link className="df-strip-button" to="/products/import">{messages.imports.banner.view}</Link>}>
          {online ? (
            <Said title={messages.imports.banner.title} body={fill(messages.imports.banner.body, { done: formatCount(importing.done), total: formatCount(importing.ready) })} />
          ) : (
            <Said title={messages.imports.banner.pausedTitle} body={messages.imports.banner.pausedBody} />
          )}
        </Strip>
      )}
      {!online && (
        <Strip tone="offline">
          <Said title={words.offline.title} body={words.offline.body} />
        </Strip>
      )}
    </>
  )
}
