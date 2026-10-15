import type { Seat } from '../../nav'

// Settings is the Owner's (FIRST-RELEASE (store) §15; ACCESS.md §5). The API needs an Owner-only permission for every Settings write, but not for every read:
// `storeInfo`, `markets` and `taxSetup` need only `catalog.read`, so for those this gate is all that keeps a Manager out. Don't drop it on the API's account.
export const isOwner = (seat: Seat | null): boolean => seat?.side === 'merchant' && seat.role === 'owner'

/** A store past due can be looked at but not changed. */
export const settingsAccess = (seat: Seat | null, readOnly: boolean) => ({ allowed: isOwner(seat), canEdit: isOwner(seat) && !readOnly })
