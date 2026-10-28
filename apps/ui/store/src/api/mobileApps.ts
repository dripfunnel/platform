import { z } from 'zod'
import { actingHeaders } from '../acting'
import { query } from './client'

// Settings › Mobile apps (SH 15, docs/mobile-app/README.md §3): the store's apps' icon, splash and listing text, the Owner's.

export const appFiles = ['appIcon', 'appIconForeground', 'splash'] as const
export type AppFile = (typeof appFiles)[number]

/** The server's limits (apps/api saas/storeApps), which the form shows so nobody finds them out by being refused. */
export const appTextLimits = { appName: 30, shortDescription: 80, longDescription: 4000 } as const
export const maxAppFileBytes = 512 * 1024

const assetsSchema = z.object({
  version: z.number().int(),
  appIcon: z.string().nullable(),
  appIconForeground: z.string().nullable(),
  splash: z.string().nullable(),
  appName: z.string().nullable(),
  shortDescription: z.string().nullable(),
  longDescription: z.string().nullable(),
  savedAt: z.string(),
})
export type MobileAppAssets = z.infer<typeof assetsSchema>

export interface MobileApps {
  /** False for a plan without `own_apps`: no tab. */
  available: boolean
  current: MobileAppAssets | null
}

const fields = 'version appIcon appIconForeground splash appName shortDescription longDescription savedAt'

export const loadMobileApps = async (): Promise<MobileApps> =>
  (await query(`{ mobileApps { available current { ${fields} } } }`, z.object({ mobileApps: z.object({ available: z.boolean(), current: assetsSchema.nullable() }) }))).mobileApps

/** What a save sends: the key an upload answered, or null for none, and the text (empty is none). */
export interface MobileAppsInput {
  appIcon: string | null
  appIconForeground: string | null
  splash: string | null
  appName: string
  shortDescription: string
  longDescription: string
}

/** Adds a version; saving what is live adds none. Refused by code (INVALID_INPUT, UNKNOWN_FILE, PLAN_LIMIT, FORBIDDEN). */
export const saveMobileApps = async (input: MobileAppsInput): Promise<MobileAppAssets> =>
  (await query(`mutation S($input: MobileAppsInput!) { saveMobileApps(input: $input) { ${fields} } }`, z.object({ saveMobileApps: assetsSchema }), { input })).saveMobileApps

export const uploadRefusals = ['TOO_LARGE', 'NOT_PNG', 'UNSUPPORTED_TYPE', 'WRONG_DIMENSIONS', 'HAS_TRANSPARENCY', 'PLAN_LIMIT', 'FORBIDDEN', 'READ_ONLY', 'SUPPORT_READ_ONLY', 'BLOCKED_FOR_SUPPORT', 'NOT_CONNECTED'] as const
export type UploadRefusal = (typeof uploadRefusals)[number]

/** The URL a stored image is read back from for the preview; it needs the acting store's headers, so it goes through AssetImage. */
export const appFileUrl = (key: string): string => `/api/app-assets?key=${encodeURIComponent(key)}`

const uploadSchema = z.union([z.object({ ok: z.literal(true), key: z.string().min(1) }), z.object({ ok: z.literal(false), code: z.string() })])

/** The raw file to `/api/app-assets`: the key it was stored under, or why not. The server checks the image; the browser only forwards it. */
export const uploadAppFile = async (kind: AppFile, file: Blob): Promise<{ ok: true; key: string } | { ok: false; code: UploadRefusal }> => {
  try {
    const response = await fetch(`/api/app-assets?kind=${kind}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { ...actingHeaders(), 'content-type': file.type || 'application/octet-stream' },
      body: file,
      signal: AbortSignal.timeout(60_000),
    })
    const answer = uploadSchema.safeParse(await response.json())
    if (!answer.success) return { ok: false, code: 'NOT_CONNECTED' }
    if (answer.data.ok) return { ok: true, key: answer.data.key }
    const code = z.enum(uploadRefusals).safeParse(answer.data.code)
    return { ok: false, code: code.success ? code.data : 'NOT_CONNECTED' }
  } catch {
    return { ok: false, code: 'NOT_CONNECTED' }
  }
}
