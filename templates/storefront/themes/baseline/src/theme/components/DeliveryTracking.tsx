import { clsx } from 'clsx'
import { Link, type OrderTracking } from '@dripfunnel/storefront-core/theme'
import { shop } from './styles/shop'
import { order as styles } from './styles/order'

/**
 * An own-delivery order's delivery on its page (api/DELIVERY.md §7): the steps, and while a rider has the order the rider and
 * the handover code. Core words everything and sends no map, position or estimate; this only lays it out.
 */
export const DeliveryTracking = ({ tracking }: { tracking: OrderTracking }) => (
  <div className={styles.card}>
    <h2 className={styles.cardTitle}>{tracking.title}</h2>
    <p className={styles.trackStatus}>
      <strong>{tracking.status}</strong> {tracking.lead}
    </p>
    <ol className={styles.steps} aria-label={tracking.stepsLabel}>
      {tracking.steps.map((s) => (
        <li key={s.state} className={clsx("pt-0 pr-0 pb-3.5 pl-7 relative flex flex-col gap-y-0.5 gap-x-0.5 [&::before]:border-[2px] [&::before]:absolute [&::before]:top-1 [&::before]:left-0 [&::before]:w-3.5 [&::before]:h-3.5 [&::before]:rounded-[50%] [&::before]:[content:''] [&::after]:absolute [&::after]:top-5.5 [&::after]:-bottom-0.5 [&::after]:left-1.75 [&::after]:w-0.5 [&::after]:[content:''] last:pb-0 [&:last-child::after]:hidden", !(s.progress === 'done' || s.progress === 'current' || s.state === 'failed') && '[&::before]:border-line', !(s.progress === 'done' || s.state === 'failed') && '[&::before]:bg-surface', !(s.progress === 'done') && '[&::after]:bg-line', s.progress === 'done' && 'group/order-stepDone [&::after]:bg-accent', s.progress === 'done' && !(s.state === 'failed') && '[&::before]:border-accent [&::before]:bg-accent', s.progress === 'current' && 'group/order-stepCurrent [&::before]:[box-shadow:inset_0_0_0_3px_var(--color-surface),inset_0_0_0_7px_var(--color-accent)]', s.progress === 'current' && !(s.state === 'failed') && '[&::before]:border-accent', s.state === 'failed' && styles.stepBad)} aria-current={s.progress === 'current' ? 'step' : undefined}>
          {s.progress === 'done' && s.state !== 'failed' && s.state !== 'cancelled' ? <span className={styles.tick} aria-hidden="true" /> : null}
          <span className={styles.hidden}>{s.progressLabel}</span>
          <span className={styles.stepLabel}>{s.label}</span>
          {s.at ? <span className={styles.note}>{s.at}</span> : null}
        </li>
      ))}
    </ol>
    {tracking.rider ? (
      <div className={styles.rider}>
        <p className={styles.riderName}>
          <span className={styles.note}>{tracking.rider.title}</span>
          <strong>{tracking.rider.name}</strong>
          {tracking.rider.vehicle ? <span className={styles.note}>{tracking.rider.vehicle}</span> : null}
        </p>
        {tracking.rider.call ? (
          <Link href={tracking.rider.call.href} className={shop.secondary}>
            {tracking.rider.call.label}
          </Link>
        ) : null}
      </div>
    ) : null}
    {tracking.code ? (
      <div className={styles.code}>
        <h3 className={styles.codeTitle}>{tracking.code.title}</h3>
        <p className={styles.codeDigits}>
          <span className={styles.hidden}>{tracking.code.label}</span>
          <span aria-hidden="true">{tracking.code.value}</span>
        </p>
        <p className={styles.note}>{tracking.code.hint}</p>
      </div>
    ) : null}
  </div>
)
