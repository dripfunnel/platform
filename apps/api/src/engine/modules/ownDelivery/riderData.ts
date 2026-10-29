import { z } from 'zod'
import { csvLine } from '#core/csv'
import type { CatalogExportRow } from '#db/scoped/catalogExports'
import type { ScopedSql } from '#db/scoped/index'
import { deleteRiderDevices } from '#db/scoped/pushDevices'
import {
  deleteOwnUploads,
  deleteRiderExports,
  deleteRiderCodes,
  deleteRiderPosition,
  deleteRiderSessions,
  eraseRiderLabels,
  eraseRiderRow,
  lockRiderToErase,
  scrubRiderOutbox,
  selectRiderDeliveriesForExport,
  selectRiderForExport,
  selectRiderSessionsForExport,
} from '#db/scoped/riders'
import { releaseRiderDeliveries, type DispatchFacts } from './dispatch'

// A rider's personal data, which is the store's (DELIVERY §5, built on #874): the Owner's export of it, and the erasure the
// Owner's `eraseRider` and the rider's own Delete my account share.

export const riderExportFilter = z.strictObject({ riderId: z.guid() })

/** Deliveries and sign-ins in one file, each cut here with a last line saying so. */
export const riderExportMaxRows = 10_000

const iso = (at: Date | null) => at?.toISOString() ?? null

/** The file the export job writes: the profile, the deliveries (never the customer's name, address or phone) and the sign-in times. */
export const buildRiderExport = async (tx: ScopedSql, job: CatalogExportRow): Promise<{ rows: number; truncated: boolean; csv: string }> => {
  const { riderId } = riderExportFilter.parse(job.filter)
  const profile = await selectRiderForExport(tx, job.store_id, riderId)
  if (!profile) throw new Error('rider export: no such rider')
  const deliveries = await selectRiderDeliveriesForExport(tx, job.store_id, riderId, riderExportMaxRows + 1)
  const sessions = await selectRiderSessionsForExport(tx, job.store_id, riderId, riderExportMaxRows + 1)
  const truncated = deliveries.length > riderExportMaxRows || sessions.length > riderExportMaxRows
  const shownDeliveries = deliveries.slice(0, riderExportMaxRows)
  const shownSessions = sessions.slice(0, riderExportMaxRows)
  const lines = [
    csvLine(['Rider']),
    csvLine(['name', 'mobile number', 'status', 'vehicle type', 'vehicle number', 'added']),
    csvLine([profile.name, profile.phone, profile.status, profile.vehicle_type, profile.vehicle_number, iso(profile.created_at)]),
    '',
    csvLine(['Deliveries']),
    csvLine(['created', 'state', 'location', 'customer area', 'cash collected', 'assigned', 'picked up', 'delivered', 'not delivered', 'reason']),
    ...shownDeliveries.map((d) =>
      csvLine([iso(d.created_at), d.state, d.warehouse, d.area, d.cash_collected ? 'yes' : 'no', iso(d.assigned_at), iso(d.picked_up_at), iso(d.delivered_at), iso(d.failed_at), d.failed_reason]),
    ),
    '',
    csvLine(['Sign-ins']),
    csvLine(['signed in', 'last used', 'signed out']),
    ...shownSessions.map((s) => csvLine([iso(s.created_at), iso(s.last_seen_at), iso(s.ended_at)])),
  ]
  if (truncated) lines.push('', `Cut at ${riderExportMaxRows} rows of each list: the earliest are included.`)
  return { rows: shownDeliveries.length + shownSessions.length, truncated, csv: lines.join('\n') }
}

/**
 * Removes the rider as removal does and then everything that names or reaches them: sessions, devices, position, codes, photos,
 * earlier exports, queued texts and pushes, and their name on the past (the row's and the log's labels). The deliveries stay with "Former rider".
 * Assigned ones are handed back; a parcel in hand refuses it (`RIDER_HAS_PARCEL`). Null for a rider this store doesn't have;
 * otherwise the photos' keys, for the caller to delete from the bucket once this has committed.
 */
export const eraseRiderData = async (tx: ScopedSql, f: DispatchFacts, riderId: string, reason: string): Promise<{ keys: string[] } | null> => {
  const rider = await lockRiderToErase(tx, f.storeId, riderId)
  if (!rider) return null
  await releaseRiderDeliveries(tx, f, riderId, reason)
  await deleteRiderSessions(tx, f.storeId, riderId)
  await deleteRiderDevices(tx, f.storeId, riderId)
  await deleteRiderPosition(tx, f.storeId, riderId)
  if (rider.phone) await deleteRiderCodes(tx, f.storeId, rider.phone)
  await eraseRiderRow(tx, f.storeId, riderId, f.now)
  const keys = await deleteOwnUploads(tx, f.storeId, riderId)
  await deleteRiderExports(tx, f.storeId, riderId)
  await scrubRiderOutbox(tx, f.storeId, riderId, rider.phone)
  await eraseRiderLabels(tx, f.storeId, riderId)
  return { keys }
}

