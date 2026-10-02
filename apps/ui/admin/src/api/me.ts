import { z } from 'zod'
import { staffRoles, type StaffRole } from '../features/shell/staffRoles'
import { query } from './client'

export interface Me {
  id: string
  name: string
  email: string
  role: StaffRole
}

const meSchema = z.object({ me: z.object({ id: z.string(), name: z.string(), email: z.string(), role: z.enum(staffRoles) }).nullable() })

// `me` is null when nobody is signed in (apps/api/src/apis/admin/schema.ts); the shell then
// sends the visitor to /sign-in.
export const loadMe = async (): Promise<Me | null> => (await query(`{ me { id name email role } }`, meSchema)).me
