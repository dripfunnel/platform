import type { Seat } from '../../nav'

// Settings is the Owner's (FIRST-RELEASE (store) §15; ACCESS.md §5). The app only declines to open it for anyone else: the API refuses every Settings
// read and write to a seat without `settings`, which is what actually protects it.
export const isOwner = (seat: Seat | null): boolean => seat?.side === 'merchant' && seat.role === 'owner'

/** A store past due can be looked at but not changed. */
export const settingsAccess = (seat: Seat | null, readOnly: boolean) => ({ allowed: isOwner(seat), canEdit: isOwner(seat) && !readOnly })
