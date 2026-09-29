import type { StaffRole } from '../features/shell/staffRoles'

export interface Me {
  name: string
  email: string
  role: StaffRole
}

const fixture: Me = { name: 'Arjun Menon', email: 'arjun@dripfunnel.com', role: 'staff-super-admin' }

// Seam: replace the fixture with the Admin API's `me` query (FIRST-RELEASE.md §12, Header)
// through createApiClient from @dripfunnel/shared/graphql once the staff sign-in lands (#13).
export const loadMe = (): Promise<Me> => Promise.resolve(fixture)
