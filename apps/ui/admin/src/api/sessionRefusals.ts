import type { ActionPermission } from './permissions'

// Every refusal the Admin API returns for a staff session (ACCESS.md §8.3, agreed on #46 for
// #40); a module of its own so the decoders need not load the impersonation sample.
export const sessionRefusals = [
  'STAFF_ROLE_NOT_ALLOWED',
  'TARGET_NOT_ACTIVE',
  'PARTNER_CLOSED',
  'IMPERSONATION_ALREADY_OPEN',
  'SETUP_SESSION_ALREADY_OPEN',
  'IMPERSONATION_ALREADY_EXTENDED',
  'SETUP_SESSION_NOT_EXTENDABLE',
  'NOT_SESSION_OWNER',
  'REASON_REQUIRED',
  'REAUTH_REQUIRED',
  'SESSION_ENDED',
  'SESSION_EXPIRED',
  'NOT_FOUND',
  'SUPPLIER_NOT_SUPPORTED',
  'INVALID_INPUT',
] as const
export type SessionRefusal = (typeof sessionRefusals)[number]

export type SessionPermission = ActionPermission<SessionRefusal>
