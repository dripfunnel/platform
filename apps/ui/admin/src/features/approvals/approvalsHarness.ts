// States (?state=): loading, empty, error, denied. `denied` asks as Support, a role without the
// Approvals menu, so the page's no-access view shows; ?state=readonly does the same as Read-only.
export const approvalsStates = ['loading', 'empty', 'error', 'denied'] as const
export type ApprovalsScreenState = (typeof approvalsStates)[number]
