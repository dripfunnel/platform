import type { Seat } from '../../nav'

export type ImportAccess = { canImport: boolean; canExport: boolean }

/**
 * What the seat may do on Import & export (FIRST-RELEASE.md §13): Owner, Manager and a catalogue-tier supplier import
 * (`catalog.import`); anyone who reads the catalogue exports, a Stock-only supplier excepted. The API decides each call again.
 */
export const importAccessOf = (acting: { permissions: readonly string[] }, seat: Seat | null): ImportAccess => ({
  canImport: acting.permissions.includes('catalog.import'),
  canExport: acting.permissions.includes('catalog.read') && !(seat?.side === 'supplier' && seat.tier === 'vendor-stock'),
})
