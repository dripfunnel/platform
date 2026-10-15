import type { Seat } from '../../nav'

// Settings is the Owner's (ACCESS.md §5). Every write needs an Owner-only permission, but reads of `storeInfo`, `storeLocale`, `translationProgress`, `markets`, `taxSetup`, `invoiceSettings` and
// `catalogueSettings` need only `catalog.read`, which Staff, Managers and every supplier tier hold, so this gate alone keeps them out: don't drop it on the API's account.
export const isOwner = (seat: Seat | null): boolean => seat?.side === 'merchant' && seat.role === 'owner'

/** A store past due can be looked at but not changed. */
export const settingsAccess = (seat: Seat | null, readOnly: boolean) => ({ allowed: isOwner(seat), canEdit: isOwner(seat) && !readOnly })
