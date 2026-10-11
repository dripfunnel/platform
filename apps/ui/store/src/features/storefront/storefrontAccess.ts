// Who may do what in Storefront (FIRST-RELEASE §14; ACCESS §5.1): `storefront.read` looks (Owner and Manager),
// `publish` changes (the Owner). The server decides every write again; this only shapes the screen.

export const storefrontTabs = ['design', 'pages', 'journal', 'settings'] as const
export type StorefrontTab = (typeof storefrontTabs)[number]

export interface StorefrontAccess {
  canRead: boolean
  canEdit: boolean
  /** Why a reader can't change anything: a Manager's seat, or a store that is view-only (past due). */
  notice: 'manager' | 'readOnly' | null
}

export const storefrontAccessOf = (forced: string | null, acting: { permissions: readonly string[] }, readOnly: boolean): StorefrontAccess => {
  if (forced === 'denied') return { canRead: false, canEdit: false, notice: null }
  if (forced === 'manager') return { canRead: true, canEdit: false, notice: 'manager' }
  if (forced === 'readOnly') return { canRead: true, canEdit: false, notice: 'readOnly' }
  if (forced) return { canRead: true, canEdit: true, notice: null }
  const canRead = acting.permissions.includes('storefront.read')
  const publishes = acting.permissions.includes('publish')
  if (!canRead) return { canRead: false, canEdit: false, notice: null }
  if (readOnly) return { canRead, canEdit: false, notice: 'readOnly' }
  return { canRead, canEdit: publishes, notice: publishes ? null : 'manager' }
}
