import { clsx } from 'clsx'
import { Link, type OrderTracking } from '@dripfunnel/storefront-core/theme'

/**
 * An own-delivery order's delivery on its page (api/DELIVERY.md §7): the steps, and while a rider has the order the rider and
 * the handover code. Core words everything and sends no map, position or estimate; this only lays it out.
 */
export const DeliveryTracking = ({ tracking }: { tracking: OrderTracking }) => (
  <div className="p-4.5 border border-line flex flex-col gap-y-3 gap-x-3 rounded-card bg-surface">
    <h2 className="m-0 font-heading text-[20px] font-[var(--heading-weight)]">{tracking.title}</h2>
    <p className="m-0">
      <strong>{tracking.status}</strong> {tracking.lead}
    </p>
    <ol className="p-0 m-0 flex flex-col list-none" aria-label={tracking.stepsLabel}>
      {tracking.steps.map((s) => (
        <li key={s.state} className={clsx("pt-0 pr-0 pb-3.5 pl-7 relative flex flex-col gap-y-0.5 gap-x-0.5 [&::before]:border-[2px] [&::before]:absolute [&::before]:top-1 [&::before]:left-0 [&::before]:w-3.5 [&::before]:h-3.5 [&::before]:rounded-[50%] [&::before]:[content:''] [&::after]:absolute [&::after]:top-5.5 [&::after]:-bottom-0.5 [&::after]:left-1.75 [&::after]:w-0.5 [&::after]:[content:''] last:pb-0 [&:last-child::after]:hidden", !((s.progress === 'done') || (s.progress === 'current') || (s.state === 'failed')) && '[&::before]:border-line', !((s.progress === 'done') || (s.state === 'failed')) && '[&::before]:bg-surface', !(s.progress === 'done') && '[&::after]:bg-line', s.progress === 'done' && 'group/order-stepDone [&::before]:border-accent [&::before]:bg-accent [&::after]:bg-accent', s.progress === 'current' && 'group/order-stepCurrent [&::before]:border-accent [&::before]:[box-shadow:inset_0_0_0_3px_var(--color-surface),inset_0_0_0_7px_var(--color-accent)]', s.state === 'failed' && '[&::before]:border-danger [&::before]:bg-danger')} aria-current={s.progress === 'current' ? 'step' : undefined}>
          {s.progress === 'done' && s.state !== 'failed' && s.state !== 'cancelled' ? <span className="border-t-0 border-r-[2px] border-b-[2px] border-l-0 border-surface absolute top-1.5 left-1.25 w-1 h-2 [transform:rotate(45deg)]" aria-hidden="true" /> : null}
          <span className="absolute overflow-hidden w-px h-px [clip-path:inset(50%)] whitespace-nowrap">{s.progressLabel}</span>
          <span className="text-ink-soft group-[:nth-child(n)]/order-stepDone:text-ink group-[:nth-child(n)]/order-stepCurrent:text-ink group-[:nth-child(n)]/order-stepCurrent:font-bold">{s.label}</span>
          {s.at ? <span className="m-0 text-ink-soft text-[14px]">{s.at}</span> : null}
        </li>
      ))}
    </ol>
    {tracking.rider ? (
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-y-3 gap-x-3">
        <p className="m-0 flex flex-col gap-y-0.5 gap-x-0.5">
          <span className="m-0 text-ink-soft text-[14px]">{tracking.rider.title}</span>
          <strong>{tracking.rider.name}</strong>
          {tracking.rider.vehicle ? <span className="m-0 text-ink-soft text-[14px]">{tracking.rider.vehicle}</span> : null}
        </p>
        {tracking.rider.call ? (
          <Link href={tracking.rider.call.href} className="py-0 px-5.5 border border-line inline-flex min-h-12 items-center justify-center self-start rounded-button [font-family:inherit] [font-size:inherit] [font-style:inherit] [line-height:inherit] font-semibold no-underline cursor-pointer bg-surface text-ink disabled:opacity-[0.6] disabled:cursor-default group-[:nth-child(n)]/shop-noticeActions:[align-self:auto] focus-visible:[outline:2px_solid_var(--color-focus)] focus-visible:outline-offset-[2px]">
            {tracking.rider.call.label}
          </Link>
        ) : null}
      </div>
    ) : null}
    {tracking.code ? (
      <div className="p-3.5 border border-line flex flex-col gap-y-1.5 gap-x-1.5 rounded-card bg-soft">
        <h3 className="m-0 text-[15px]">{tracking.code.title}</h3>
        <p className="m-0 text-[32px] [font-variant-numeric:tabular-nums] font-bold tracking-[0.3em]">
          <span className="absolute overflow-hidden w-px h-px [clip-path:inset(50%)] whitespace-nowrap">{tracking.code.label}</span>
          <span aria-hidden="true">{tracking.code.value}</span>
        </p>
        <p className="m-0 text-ink-soft text-[14px]">{tracking.code.hint}</p>
      </div>
    ) : null}
  </div>
)
