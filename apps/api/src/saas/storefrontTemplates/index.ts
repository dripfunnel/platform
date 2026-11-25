import type postgres from 'postgres'
import type { ActivityLog, RequestFacts } from '#auth/activity'
import { roleHas } from '#auth/permissions'
import type { PreviewLinks } from '#auth/previewLink'
import type { StaffMember } from '#auth/staff'
import { withSystemScope } from '#db/scoped/index'
import { selectTemplateDemo, selectTemplatesForStaff, type StaffTemplateRow } from '#db/scoped/storefrontTemplates'
import { staffEntry } from '#saas/staff/index'
import { previewLinkFor } from '#saas/storefronts/preview'
import { startDemo } from './demo'

// The template catalogue on the Admin API (admin CONSOLE-DESIGN L4, FIRST-RELEASE §11d): the list, and a category
// template's preview from its demo store, which a Super admin's first Preview makes.

export const templateAudit = { demoCreated: 'storefront_template.demo_created', previewOpened: 'storefront_template.preview_opened' } as const

export type DemoState = 'none' | 'creating' | 'ready'
export type StaffTemplate = Omit<StaffTemplateRow, 'demo_store_id' | 'demo_ready'> & { demo: DemoState }
export type PreviewRefusal = 'NOT_FOUND' | 'NO_DEMO' | 'NO_SAMPLE' | 'NO_HOUSE_PARTNER' | 'PREVIEW_OFF'
export type PreviewResult = { ok: true; demo: DemoState; url: string | null } | { ok: false; code: PreviewRefusal }

const demoOf = (row: StaffTemplateRow): DemoState => (!row.demo_store_id ? 'none' : row.demo_ready ? 'ready' : 'creating')

export interface TemplateAdminDeps {
  sql: postgres.Sql
  staff: StaffMember
  activity: ActivityLog
  facts: RequestFacts
  /** Signs preview links; null where PREVIEW_LINK_KEY or SHOP_DOMAIN isn't set. */
  preview: { domain: string; links: PreviewLinks } | null
  now: () => Date
}

export const createTemplateAdminService = ({ sql, staff, activity, facts, preview, now }: TemplateAdminDeps) => {
  const entry = staffEntry(staff, facts)

  // System scope throughout: staff hold no read on `storefront`, and demo stores are hidden from them (0416).
  const list = async (): Promise<StaffTemplate[]> =>
    (await withSystemScope(sql, selectTemplatesForStaff)).map((row) => ({
      key: row.key,
      name: row.name,
      tag: row.tag,
      description: row.description,
      state: row.state,
      categories: row.categories,
      store_count: row.store_count,
      demo: demoOf(row),
    }))

  const makeDemo = (key: string, name: string): Promise<PreviewResult> =>
    withSystemScope(sql, async (tx) => {
      const made = await startDemo(tx, key, now())
      if (!made.ok) return made
      if (made.created) await activity.record(tx, entry({ action: templateAudit.demoCreated, reason: null, target: { type: 'storefront_template', id: key, label: name }, visibility: 'staff', storeId: made.storeId }))
      return { ok: true, demo: 'creating', url: null } as const
    })

  /** The demo's signed link once its preview is in place; a Super admin's first press makes the demo. */
  const previewLink = async (key: string): Promise<PreviewResult> => {
    if (!preview) return { ok: false, code: 'PREVIEW_OFF' }
    // One read, and the opening recorded in the same transaction once the demo is ready to open.
    const found = await withSystemScope(sql, async (tx) => {
      const template = await selectTemplateDemo(tx, key)
      if (template?.demo_store_id && template.owner_id && template.preview_ref)
        await activity.record(tx, entry({ action: templateAudit.previewOpened, reason: null, target: { type: 'storefront_template', id: key, label: template.name }, visibility: 'staff', storeId: template.demo_store_id }))
      return template
    })
    if (!found) return { ok: false, code: 'NOT_FOUND' }
    if (!found.demo_store_id) return roleHas(staff.role, 'storeCategories.manage') ? makeDemo(key, found.name) : { ok: false, code: 'NO_DEMO' }
    if (!found.owner_id || !found.preview_ref) return { ok: true, demo: 'creating', url: null }
    const url = await previewLinkFor(sql, preview.links, preview.domain, found.demo_store_id, found.owner_id, now())
    return url ? { ok: true, demo: 'ready', url } : { ok: false, code: 'NOT_FOUND' }
  }

  return { list, previewLink }
}

export type TemplateAdminService = ReturnType<typeof createTemplateAdminService>
