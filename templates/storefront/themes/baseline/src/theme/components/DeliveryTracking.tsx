import { clsx } from 'clsx'
import { Link, type OrderTracking } from '@dripfunnel/storefront-core/theme'
import shop from '../styles/shop.module.css'
import styles from '../styles/order.module.css'

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
        <li key={s.state} className={clsx(styles.step, s.progress === 'done' && styles.stepDone, s.progress === 'current' && styles.stepCurrent, s.state === 'failed' && styles.stepBad)} aria-current={s.progress === 'current' ? 'step' : undefined}>
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
