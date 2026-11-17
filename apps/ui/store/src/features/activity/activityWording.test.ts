import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { messages } from '../../messages'

// #1488: every action code the API records for a store's Activity log has wording, so no entry shows a raw code.
const apiSource = fileURLToPath(new URL('../../../../../api/src/', import.meta.url))
const roots = ['engine/modules', 'apis/store', 'saas', 'auth']

// Codes recorded for the partner and admin consoles' logs only (LOGGING §6); a code not listed here needs wording.
const consolePrefixes = ['partner.', 'partner_user.', 'plan.', 'staff.', 'staff_session.', 'setup_session.', 'core_rollout.', 'job.', 'branding.', 'report.', 'store_category.', 'platform.']
const consoleCodes = new Set([
  'support_session.link_reissued',
  'support_session.entered',
  'impersonation.started',
  'impersonation.extended',
  'store.crossing_refused',
  'storefront.core_pinned',
  'storefront.baseline_served',
  'storefront.build_refused',
  'storefront.build_started',
  'storefront.build_credentials_issued',
  'storefront.created',
  'storefront.create_failed',
  'storefront.publish_failed',
  'storefront.published',
  'storefront.rolled_back',
  'storefront.publish_refused',
  'storefront.repo_publish',
  'store.trial_extended',
  'store.limit_override_added',
  'store.limit_override_removed',
  'store.archived',
  'store.invitation_resent',
  'store.setup_step_retried',
  'store.billing_status_set',
  'store.suspension_flagged_for_review',
  'store.note_added',
  'store.domain_recheck_requested',
  'store.delivery_app_uploaded',
  'store.delivery_app_minimum_build_set',
  'app.registered',
  'app.status_changed',
  'customer.viewed',
])

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return path.endsWith('.ts') && !path.endsWith('.test.ts') ? [path] : []
  })

/** The API's `xAudit = { key: 'thing.did' }` constants, and codes written as bare strings where an entry is built. */
const recordedCodes = (): string[] => {
  const codes = new Set<string>()
  for (const root of roots) {
    for (const file of sourceFiles(join(apiSource, root))) {
      const source = readFileSync(file, 'utf8')
      for (const block of source.matchAll(/\w*[Aa]udit\w*\s*=\s*\{([^}]*)\}/g)) {
        for (const code of (block[1] ?? '').matchAll(/:\s*'([a-z_]+\.[a-z_.]+)'/g)) if (code[1]) codes.add(code[1])
      }
      for (const bare of source.matchAll(/\baction:\s*'([a-z_]+\.[a-z_.]+)'|(?:systemEntry|entry|record|change)\([^()\n]*?,\s*'([a-z_]+\.[a-z_.]+)'/g)) {
        const code = bare[1] ?? bare[2]
        if (code) codes.add(code)
      }
    }
  }
  return [...codes].filter((code) => !consoleCodes.has(code) && !consolePrefixes.some((prefix) => code.startsWith(prefix))).sort()
}

describe('the Activity log’s wording', () => {
  it('finds the API’s action codes, so the check below is not empty', () => {
    expect(recordedCodes().length).toBeGreaterThan(150)
  })

  it('has wording for every action code a store can see', () => {
    const worded = new Set(Object.keys(messages.activity.actions))
    expect(recordedCodes().filter((code) => !worded.has(code))).toEqual([])
  })

  it('words the tax and rider actions from the card as words', () => {
    const actions: Record<string, string> = messages.activity.actions
    expect(actions['tax_rate.set']).toBe('changed the tax rate for {target}')
    expect(actions['tax_zone.saved']).toBe('saved tax zone {target}')
    expect(actions['tax_zone.deleted']).toBe('deleted tax zone {target}')
    expect(actions['tax_class.saved']).toBe('saved tax category {target}')
    expect(actions['tax_class.deleted']).toBe('deleted tax category {target}')
    expect(actions['tax.inclusive_changed']).toBe('changed whether prices include tax')
    expect(actions['invoice_settings.saved']).toBe('saved invoice settings')
  })
})
