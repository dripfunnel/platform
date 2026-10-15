import type { Seat } from '../../nav'

// Settings is the Owner's (ACCESS.md §5). Every write needs an Owner-only permission, but reads of `storeInfo`, `storeLocale`, `translationProgress`, `markets`, `taxSetup` and
// `catalogueSettings` need only `catalog.read`, so this gate alone keeps a Manager out of them: don't drop it on the API's account.
export const isOwner = (seat: Seat | null): boolean => seat?.side === 'merchant' && seat.role === 'owner'

/** A store past due can be looked at but not changed. */
export const settingsAccess = (seat: Seat | null, readOnly: boolean) => ({ allowed: isOwner(seat), canEdit: isOwner(seat) && !readOnly })
