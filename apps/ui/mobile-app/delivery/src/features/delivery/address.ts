import type { Address } from '../../api/delivery'

/** An address on one line, whichever parts it has. */
export const addressLine = (address: Address | null): string =>
  address ? [address.line1, address.line2, address.city, address.region, address.postalCode].filter((part): part is string => Boolean(part)).join(', ') : ''
