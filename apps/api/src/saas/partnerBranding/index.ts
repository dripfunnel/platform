import type postgres from 'postgres'
import { z } from 'zod'
import type { ActivityEntry, ActivityLog, RequestFacts } from '#auth/activity'
import { actingName, agentOf, type PartnerCaller, partnerContextOf } from '#auth/partnerCaller'
import { partnerRoleHas } from '#auth/partnerPermissions'
import { mirrorPartnerLook, publishBrandingDraft, saveBrandingDraft, selectBranding, type BrandingFields, type BrandingRow } from '#db/scoped/branding'
import { partnerEntry } from '#saas/activity/index'
import { withScope, type ScopedSql } from '#db/scoped/index'
import { insertOutbox } from '#db/scoped/outbox'
import { selectShellFacts } from '#db/scoped/partnerConsole'
import { selectContractTerms } from '#db/scoped/partnerPlans'
import { selectPartner, upsertSetupItem } from '#db/scoped/partners'
import type { PartnerRow } from '#db/schema/saas'
import { contrastReport, type ContrastReport } from './contrast'

// Branding on the Platform API (ui/platform/FIRST-RELEASE.md §8; card #162): the look and the
// words, the contrast computed here, and a publish that changes every merchant's portal.

export type { ContrastReport } from './contrast'
export { brandFileKinds, maxBrandFileBytes, type BrandFileKind } from './brandFile'
export { uploadBrandFile, type BrandFileStore } from './upload'

export const brandFonts = ['Nunito', 'Source Sans 3', 'Manrope', 'Lora', 'DM Sans'] as const
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/)
// Every merchant portal renders these as links, so https only: never javascript: or data:.
const httpsUrl = (value: string) => {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}
const url = z.string().trim().max(200).refine(httpsUrl, 'an https link').or(z.literal(''))
// A file is an R2 key under the caller's own prefix (#219 uploads it), never a URL a client
// names; no segment starts with a dot, so `..` cannot leave the prefix. Empty: none yet.
const fileKey = z.string().max(200).regex(/^partners\/[0-9a-f-]{36}(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)+$/).or(z.literal(''))

export const brandingInput = z.strictObject({
  look: z.strictObject({
    productName: z.string().trim().min(1).max(60),
    primary: hex,
    accent: hex,
    font: z.enum(brandFonts),
    corner: z.enum(['rounded', 'soft', 'square']),
    background: z.enum(['sand', 'plain', 'photo']),
    files: z.strictObject({ logoLight: fileKey, logoDark: fileKey, mark: fileKey, favicon: fileKey }),
  }),
  words: z.strictObject({
    supportEmail: z.string().trim().email().max(254),
    supportUrl: url,
    helpUrl: url,
    termsUrl: url,
    privacyUrl: url,
    dpaUrl: url,
    impressum: z.string().trim().max(2000),
    poweredBy: z.boolean(),
  }),
})
export type BrandingInput = z.infer<typeof brandingInput>

// SAAS §3.4: the countries whose law requires an Impressum on a commercial site.
const impressumCountries = ['DE', 'AT', 'CH']

export type PublishRefusal = 'OWNERS_AND_ADMINS_ONLY' | 'POWERED_BY_FIXED_BY_CONTRACT' | 'IMPRESSUM_REQUIRED' | 'INVALID_INPUT' | 'CONTRAST_FAILS'
export type PublishResult = { ok: true; publishedAt: Date } | { ok: false; reason: PublishRefusal; field?: string; fix?: string }

export interface BrandingDto extends BrandingInput {
  /** Whether what is shown is live, or the draft not yet published. */
  published: boolean
  affects: number
  contrast: ContrastReport
  poweredByRule: 'choice' | 'fixedOn'
  impressumRequired: boolean
  dpaRequired: boolean
  permission: { allowed: true } | { allowed: false; reason: 'OWNERS_AND_ADMINS_ONLY' }
}

export const brandingAudit = { publishBranding: 'branding.published' } as const

const toInput = (row: BrandingRow): BrandingInput => ({
  look: {
    productName: row.product_name,
    primary: row.primary_color,
    accent: row.accent_color,
    font: row.font,
    corner: row.corner,
    background: row.background,
    files: { logoLight: row.logo_light_key ?? '', logoDark: row.logo_dark_key ?? '', mark: row.mark_key ?? '', favicon: row.favicon_key ?? '' },
  },
  words: {
    supportEmail: row.support_email ?? '',
    supportUrl: row.support_url ?? '',
    helpUrl: row.help_url ?? '',
    termsUrl: row.terms_url ?? '',
    privacyUrl: row.privacy_url ?? '',
    dpaUrl: row.dpa_url ?? '',
    impressum: row.impressum ?? '',
    poweredBy: row.powered_by,
  },
})

const blank = (value: string): string | null => (value === '' ? null : value)

const toFields = (input: BrandingInput): BrandingFields => ({
  product_name: input.look.productName,
  primary_color: input.look.primary,
  accent_color: input.look.accent,
  font: input.look.font,
  corner: input.look.corner,
  background: input.look.background,
  logo_light_key: blank(input.look.files.logoLight),
  logo_dark_key: blank(input.look.files.logoDark),
  mark_key: blank(input.look.files.mark),
  favicon_key: blank(input.look.files.favicon),
  support_email: input.words.supportEmail,
  support_url: blank(input.words.supportUrl),
  help_url: blank(input.words.helpUrl),
  terms_url: blank(input.words.termsUrl),
  privacy_url: blank(input.words.privacyUrl),
  dpa_url: blank(input.words.dpaUrl),
  impressum: blank(input.words.impressum),
  powered_by: input.words.poweredBy,
})

// The first page Legal pages still lacks, in the checklist's words (FIRST-RELEASE §4); null when complete.
const legalMissing = (input: BrandingInput, impressumRequired: boolean): string | null =>
  input.words.termsUrl === ''
    ? 'Terms missing'
    : input.words.privacyUrl === ''
      ? 'Privacy policy missing'
      : input.words.dpaUrl === ''
        ? 'Data-processing agreement missing'
        : impressumRequired && input.words.impressum === ''
          ? 'Impressum missing'
          : null

export interface PartnerBrandingDeps {
  sql: postgres.Sql
  caller: PartnerCaller
  facts: RequestFacts
  activity: ActivityLog
}

// A partner created without colours starts from DripFunnel's own (the style guide's brand tokens),
// a pair that passes the contrast check until the partner picks theirs.
const defaultPrimary = '#4A1B0C'
const defaultAccent = '#EC844F'

export const createPartnerBrandingService = ({ sql, caller, facts, activity }: PartnerBrandingDeps) => {
  const partnerId = caller.partner.id
  const context = partnerContextOf(caller)
  const permission = (): BrandingDto['permission'] => (partnerRoleHas(caller.role, 'branding.write') ? { allowed: true } : { allowed: false, reason: 'OWNERS_AND_ADMINS_ONLY' })

  const rules = async (tx: ScopedSql) => {
    const terms = await selectContractTerms(tx, partnerId)
    const partner = await selectPartner(tx, partnerId)
    return {
      poweredByRule: terms.powered_by_removable ? ('choice' as const) : ('fixedOn' as const),
      impressumRequired: impressumCountries.includes(partner?.country ?? ''),
    }
  }

  // A partner that has never saved a look starts from what its creation recorded (name and
  // colours) and the form's defaults, unpublished, with the same rules and permission.
  const firstDraft = (partner: PartnerRow | null): BrandingInput => ({
    look: {
      productName: partner?.product_name ?? partner?.name ?? '',
      primary: partner?.primary_color ?? defaultPrimary,
      accent: partner?.accent_color ?? defaultAccent,
      font: brandFonts[0],
      corner: 'rounded',
      background: 'sand',
      files: { logoLight: '', logoDark: '', mark: '', favicon: '' },
    },
    words: { supportEmail: '', supportUrl: '', helpUrl: '', termsUrl: '', privacyUrl: '', dpaUrl: '', impressum: '', poweredBy: true },
  })

  const branding = (): Promise<BrandingDto | null> =>
    withScope(sql, context, async (tx) => {
      const { live, draft } = await selectBranding(tx, partnerId)
      const shown = live ?? draft
      const input = shown ? toInput(shown) : firstDraft(await selectPartner(tx, partnerId))
      return {
        ...input,
        published: shown !== null && shown === live,
        affects: (await selectShellFacts(tx, partnerId)).store_count,
        contrast: contrastReport(input.look.primary, input.look.accent),
        ...(await rules(tx)),
        dpaRequired: input.words.dpaUrl === '',
        permission: permission(),
      }
    })

  const checkContrast = (primary: string, accent: string): ContrastReport | null =>
    hex.safeParse(primary).success && hex.safeParse(accent).success ? contrastReport(primary, accent) : null

  const entry = (publishedAt: Date): ActivityEntry =>
    partnerEntry(caller, facts)({ action: brandingAudit.publishBranding, target: { type: 'partner', id: partnerId, label: caller.partner.name }, reason: null, occurredAt: publishedAt })

  const publishBranding = async (raw: unknown): Promise<PublishResult> => {
    if (!permission().allowed) return { ok: false, reason: 'OWNERS_AND_ADMINS_ONLY' }
    const parsed = brandingInput.safeParse(raw)
    if (!parsed.success) return { ok: false, reason: 'INVALID_INPUT', field: parsed.error.issues[0]?.path.join('.') ?? '' }
    const input = parsed.data
    const foreign = Object.entries(input.look.files).find(([, key]) => key !== '' && !key.startsWith(`partners/${partnerId}/`))
    if (foreign) return { ok: false, reason: 'INVALID_INPUT', field: `look.files.${foreign[0]}` }
    const contrast = contrastReport(input.look.primary, input.look.accent)
    if (!contrast.passes) return { ok: false, reason: 'CONTRAST_FAILS', fix: contrast.fix ?? '' }

    return withScope(sql, context, async (tx): Promise<PublishResult> => {
      const { poweredByRule, impressumRequired } = await rules(tx)
      if (poweredByRule === 'fixedOn' && !input.words.poweredBy) return { ok: false, reason: 'POWERED_BY_FIXED_BY_CONTRACT' }
      if (impressumRequired && input.words.impressum === '') return { ok: false, reason: 'IMPRESSUM_REQUIRED' }
      const fields = toFields(input)
      const by = agentOf(caller)
      const publishedAt = await publishBrandingDraft(tx, await saveBrandingDraft(tx, partnerId, fields, by), actingName(caller))
      await mirrorPartnerLook(tx, partnerId, fields)
      // The checklist (FIRST-RELEASE §4): Branding is done by a publish; Legal pages once terms,
      // privacy and the DPA are there, and the Impressum where the law needs one.
      const done = { status: 'done' as const, doneAt: publishedAt, doneByKind: agentOf(caller).kind, doneByLabel: actingName(caller) }
      await upsertSetupItem(tx, { partnerId, item: 'branding', detail: 'Logo, colours and font saved', ...done })
      // Set either way, so a later publish without a page puts the item back to missing.
      const missing = legalMissing(input, impressumRequired)
      await upsertSetupItem(tx, missing ? { partnerId, item: 'legal', status: 'missing', detail: missing } : { partnerId, item: 'legal', detail: 'Terms, privacy and data-processing agreement added', ...done })
      await activity.record(tx, entry(publishedAt))
      // Every merchant's portal reads the look by hostname (SAAS §3.3); the purge follows the commit.
      await insertOutbox(tx, { kind: 'cache.purge', idempotencyKey: `branding:${partnerId}:${publishedAt.toISOString()}`, payload: { partnerId, reason: 'branding' }, partnerId, storeId: null })
      return { ok: true, publishedAt }
    })
  }

  return { branding, checkContrast, publishBranding }
}

export type PartnerBrandingService = ReturnType<typeof createPartnerBrandingService>
