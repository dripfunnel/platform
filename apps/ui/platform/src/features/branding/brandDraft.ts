import { brandingInput, type Branding, type BrandingInput, type PublishResult } from '../../api/branding'
import { fill, formatCount, messages, plural } from '../../messages'
import { sameJson } from '../common/sameJson'

// The draft is the API's input shape, typed as the user leaves it; a field that will not do is marked, never fixed.
export type BrandDraft = BrandingInput

export const draftOf = (branding: Branding): BrandDraft => ({ look: structuredClone(branding.look), words: structuredClone(branding.words) })

export const isDirty = (draft: BrandDraft, original: BrandDraft) => !sameJson(draft, original)

export const impressumMissing = (draft: BrandDraft, branding: Branding) => branding.impressumRequired && draft.words.impressum.trim() === ''

// What a publish changes (§8.4), and how a refusal reads: the API's fix for a contrast failure, this console's words for the rest.
export const publishConsequence = (affects: number) =>
  affects === 0 ? messages.branding.dialog.consequenceNone : fill(plural(messages.branding.dialog.consequence, affects), { count: formatCount(affects) })

export const refusalText = (result: Exclude<PublishResult, { ok: true }>) => (result.reason === 'CONTRAST_FAILS' ? result.fix : messages.branding.refused[result.reason])

export type DraftField = 'productName' | 'primary' | 'accent' | 'supportEmail' | 'supportUrl' | 'helpUrl' | 'termsUrl' | 'privacyUrl' | 'dpaUrl'

// The fields the API would reject, from its own schema, so the screen marks exactly what it will refuse.
export const invalidFields = (draft: BrandDraft): DraftField[] => {
  const result = brandingInput.safeParse(draft)
  if (result.success) return []
  const fields = new Set<DraftField>()
  for (const issue of result.error.issues) {
    const field = issue.path[1]
    if (typeof field === 'string' && ['productName', 'primary', 'accent', 'supportEmail', 'supportUrl', 'helpUrl', 'termsUrl', 'privacyUrl', 'dpaUrl'].includes(field)) fields.add(field as DraftField)
  }
  return [...fields]
}
