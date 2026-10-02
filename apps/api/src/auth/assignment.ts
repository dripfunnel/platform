import type postgres from 'postgres'
import { z } from 'zod'
import { hasLiveAssignment } from '#db/scoped/assignments'
import { withScope } from '#db/scoped/index'
import { partnerOfStore } from '#db/scoped/stores'

const uuid = z.guid()

export type AccessTarget = { partnerId: string } | { storeId: string }

/** Whether a staff member is assigned to the target's partner. An unknown target is simply
 *  not assigned, so a caller learns nothing about whether it exists. */
export const isAssigned = async (sql: postgres.Sql, staffId: string, target: AccessTarget): Promise<boolean> => {
  // A malformed id would otherwise surface as a database error rather than a plain refusal.
  if (!uuid.safeParse('partnerId' in target ? target.partnerId : target.storeId).success) return false
  return withScope(sql, { caller: { kind: 'staff', staffId } }, async (tx) => {
    const partnerId = 'partnerId' in target ? target.partnerId : await partnerOfStore(tx, target.storeId)
    return partnerId ? hasLiveAssignment(tx, partnerId, staffId) : false
  })
}
