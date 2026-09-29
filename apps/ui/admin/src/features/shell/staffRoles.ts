// The six staff roles and their keys (docs/ui/admin/README.md §2).
export const staffRoles = [
  'staff-super-admin',
  'staff-partner-manager',
  'staff-support',
  'staff-finance',
  'staff-engineer',
  'staff-read-only',
] as const

export type StaffRole = (typeof staffRoles)[number]
