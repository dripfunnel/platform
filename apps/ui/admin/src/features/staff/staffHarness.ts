// States (?state=): loading, empty, error, denied (asks as Support, who has no Staff menu),
// refused (the server's last-Super-admin refusal as it reads after a race) and confirm (Invite open).
export const staffStates = ['loading', 'empty', 'error', 'denied', 'refused', 'confirm'] as const
export type StaffScreenState = (typeof staffStates)[number]
