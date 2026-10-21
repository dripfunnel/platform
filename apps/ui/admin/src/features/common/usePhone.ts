import { isPhone } from '@dripfunnel/shared/ui'

// The phone states of FIRST-RELEASE.md §5 replace some console pages; usePhone itself is shared/ui's.

/** A route loader for a page a phone replaces (phoneView): nothing to load there. */
export const unlessPhone = <T>(load: () => Promise<T>): Promise<T> | null => (isPhone() ? null : load())

/** The screen has just widened past a phone's, so pages a phone skipped must load now. */
export const widened = (wasPhone: boolean, phone: boolean): boolean => wasPhone && !phone
