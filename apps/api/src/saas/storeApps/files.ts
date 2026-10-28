import { maxBrandFileBytes, type BrandFileKind } from '#saas/partnerBranding/brandFile'

// The store's app images are the partner's (BUILD-CHECKLIST §2): PNG, 1024 × 1024 for both icons, no transparency in the app icon, at most 512 KB.

export const appFileKinds = ['appIcon', 'appIconForeground', 'splash'] as const satisfies readonly BrandFileKind[]
export type AppFileKind = (typeof appFileKinds)[number]
export const maxAppFileBytes = maxBrandFileBytes

/** Where a store's app images live in R2, apart from its catalogue's (`stores/<id>/assets/`). */
export const appFilePrefix = (storeId: string): string => `stores/${storeId}/app/`

// The name carries the kind, so a version can tell the file passed that kind's checks.
export const appFileKey = (storeId: string, kind: AppFileKind): string => `${appFilePrefix(storeId)}${kind}-${crypto.randomUUID()}.png`

export const uploadedAsAppFile = (key: string, storeId: string, kind: AppFileKind): boolean => new RegExp(`^${appFilePrefix(storeId)}${kind}-[0-9a-f-]{36}\\.png$`).test(key)
