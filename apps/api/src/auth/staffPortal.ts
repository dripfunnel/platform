// The partner console's staff-session cookie (ACCESS.md §8.3, #243): its own name, so it never
// replaces or reads as a partner user's session on the same host.
export const staffPortalCookieName = '__Host-df_platform_staff'

// The longest session there is, a setup session's two hours (ACCESS.md §8.2); the server ends it sooner.
const maxAgeSeconds = 2 * 60 * 60

export const setStaffPortalCookie = (id: string): string => `${staffPortalCookieName}=${id}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`

export const clearStaffPortalCookie = (): string => `${staffPortalCookieName}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`
