import { ApiError } from '@dripfunnel/shared/graphql'
import { redirect } from '@tanstack/react-router'
import { actingStore, rememberActing } from '../../acting'
import { isApiError } from '../../api/client'
import { shellSample } from '../../api/sample'
import { badgesOf, readShell, seatOf, storesFrom, type Acting, type Me, type StoreChoice, type StoreState } from '../../api/shell'
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

const shellFields: readonly string[] = ['me', 'myStores', 'storeState', 'navBadges']

/**
 * The signed-in person in their acting store, before any screen loads (ACCESS.md §4). Nobody signed
 * in goes to sign-in and comes back; no acting store, or one no longer held, goes to the chooser.
 */
export const loadShell = async (search: ShellSearch, here: string): Promise<ShellData> => {
  const sample = shellSample(search)
  const sampleSeat = sample?.me.acting ? seatOf(sample.me.acting) : null
  if (sample?.me.acting && sampleSeat) return { me: sample.me, acting: sample.me.acting, seat: sampleSeat, stores: sample.stores, state: sample.state, badges: sample.badges }
  const { data, errors } = await readShell()
  // A refusal tied to none of the shell's fields (no path) is the whole answer failing: the error screen.
  const stray = errors.find((e) => !shellFields.includes(String(e.path[0])))
  if (stray) throw stray.error
  const refused = (field: string) => errors.find((e) => e.path[0] === field)?.error
  const meRefused = refused('me')
  if (meRefused) throw meRefused
  const me = data.me
  if (!me) throw redirect({ to: '/sign-in', search: { next: here } })
  const seat = me.acting ? seatOf(me.acting) : null
  if (!me.acting || !seat) {
    // The remembered store is no longer theirs (removed, suspended): the chooser asks again.
    if (actingStore()) rememberActing(null)
    throw redirect({ to: '/stores', search: { next: here } })
  }
  const forget = () => {
    rememberActing(null)
    return redirect({ to: '/stores', search: { next: here } })
  }
  // The store's reads refused FORBIDDEN: it is no longer held. A refused badge count only draws no badge.
  const failed = [refused('storeState'), refused('myStores')].filter((e): e is ApiError => e !== undefined)
  if (failed.some((e) => isApiError(e, 'FORBIDDEN'))) throw forget()
  if (failed[0]) throw failed[0]
  if (!data.myStores) throw new ApiError('EMPTY_RESPONSE', 'The API returned no stores.')
  try {
    const stores = await storesFrom(data.myStores)
    return { me, acting: me.acting, seat, stores, state: data.storeState, badges: badgesOf(data.navBadges) }
  } catch (error) {
    if (isApiError(error, 'FORBIDDEN')) throw forget()
    throw error
  }
}
