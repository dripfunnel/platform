import type { StaffRole } from '../shell/staffRoles'

// ACCESS.md §5.4 `stores.deliveryApp.write`; the API enforces it, this only turns the controls off.
const writers: readonly StaffRole[] = ['staff-super-admin', 'staff-engineer']

export const canChangeDeliveryApp = (role: StaffRole): boolean => writers.includes(role)
