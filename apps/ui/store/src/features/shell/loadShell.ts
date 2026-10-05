import { redirect } from '@tanstack/react-router'
import { actingStore, rememberActing } from '../../acting'
import { isApiError } from '../../api/client'
import { shellSample } from '../../api/sample'
import { loadMe, loadMyStores, loadNavBadges, loadStoreState, seatOf, type Acting, type Me, type StoreChoice, type StoreState } from '../../api/shell'
import type { NavBadgeSource, Seat } from '../../nav'

export interface ShellSearch {
  as?: string | undefined
  store?: string | undefined
  state?: string | undefined
}

export interface ShellData {
  me: Me
  acting: Acting
  seat: Seat
  stores: StoreChoice[]
  state: StoreState | null
  badges: Record<NavBadgeSource, number>
}

// A badge is a hint: when its count fails the menu draws none rather than the screen failing.
const noBadges: Record<NavBadgeSource, number> = { ordersToShip: 0, productsToApprove: 0 }

/**
 * The signed-in person in their acting store, before any screen loads (ACCESS.md §4). Nobody signed
 * in goes to sign-in and comes back; no acting store, or one no longer held, goes to the chooser.
 */
export const loadShell = async (search: ShellSearch, here: string): Promise<ShellData> => {
  const sample = shellSample(search)
  const sampleSeat = sample?.me.acting ? seatOf(sample.me.acting) : null
  if (sample?.me.acting && sampleSeat) return { me: sample.me, acting: sample.me.acting, seat: sampleSeat, stores: sample.stores, state: sample.state, badges: sample.badges }
  const me = await loadMe()
  if (!me) throw redirect({ to: '/sign-in', search: { next: here } })
  const seat = me.acting ? seatOf(me.acting) : null
  if (!me.acting || !seat) {
    // The remembered store is no longer theirs (removed, suspended): the chooser asks again.
    if (actingStore()) rememberActing(null)
    throw redirect({ to: '/stores', search: { next: here } })
  }
  try {
    const [stores, state, badges] = await Promise.all([loadMyStores(), loadStoreState(), loadNavBadges().catch(() => noBadges)])
    return { me, acting: me.acting, seat, stores, state, badges }
  } catch (error) {
    if (isApiError(error, 'FORBIDDEN')) {
      rememberActing(null)
      throw redirect({ to: '/stores', search: { next: here } })
    }
    throw error
  }
}
