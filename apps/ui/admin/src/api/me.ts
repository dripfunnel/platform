import type { StaffRole } from '../features/shell/staffRoles'

export interface Me {
  id: string
  name: string
  email: string
  role: StaffRole
}

const fixture: Me = { id: 'st-arjun', name: 'Arjun Menon', email: 'arjun@dripfunnel.com', role: 'staff-super-admin' }

// Seam: replace the fixture with the Admin API's `me` query (FIRST-RELEASE.md §12, Header)
// through createApiClient from @dripfunnel/shared/graphql once the staff sign-in lands
// (https://github.com/dripfunnel/platform/issues/13). The fixture is a Super admin and nothing
// guards /_app yet, so it must be gone before the console holds real data.
export const loadMe = (): Promise<Me> => Promise.resolve(fixture)
