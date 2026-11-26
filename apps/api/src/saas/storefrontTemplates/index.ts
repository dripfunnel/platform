import type postgres from 'postgres'
import type { ActivityLog, RequestFacts } from '#auth/activity'
import { roleHas } from '#auth/permissions'
import type { StaffMember } from '#auth/staff'
import { withSystemScope } from '#db/scoped/index'
import { selectTemplateDemo, selectTemplatesForStaff, type StaffTemplateRow } from '#db/scoped/storefrontTemplates'
import { staffEntry } from '#saas/staff/index'
import { startDemo } from './demo'
import { demoAddress } from './demoSite'

export { demoAddress, lookupDemoSite, type DemoSite } from './demoSite'

// The template catalogue on the Admin API (admin CONSOLE-DESIGN L4, FIRST-RELEASE §11d): the list, and a category
// template's demo, which a Super admin's first Preview makes.

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
  /** SHOP_DOMAIN, which the demo host is under; null where it isn't set. */
  shopDomain: string | null
  now: () => Date
}

export const createTemplateAdminService = ({ sql, staff, activity, facts, shopDomain, now }: TemplateAdminDeps) => {
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

  /** The demo's open address once the demo host serves it (PREVIEW §9); a Super admin's first press makes the demo. */
  const previewLink = async (key: string): Promise<PreviewResult> => {
    if (!shopDomain) return { ok: false, code: 'PREVIEW_OFF' }
    // One read, and the opening recorded in the same transaction once the demo opens.
    const found = await withSystemScope(sql, async (tx) => {
      const template = await selectTemplateDemo(tx, key)
      if (template?.served && template.demo_store_id)
        await activity.record(tx, entry({ action: templateAudit.previewOpened, reason: null, target: { type: 'storefront_template', id: key, label: template.name }, visibility: 'staff', storeId: template.demo_store_id }))
      return template
    })
    if (!found) return { ok: false, code: 'NOT_FOUND' }
    if (!found.demo_store_id) return roleHas(staff.role, 'storeCategories.manage') ? makeDemo(key, found.name) : { ok: false, code: 'NO_DEMO' }
    if (!found.preview_ref) return { ok: true, demo: 'creating', url: null }
    // A retired template, or a closed demo store or partner: the demo host would answer "No demo for this template".
    if (!found.served) return { ok: false, code: 'NOT_FOUND' }
    return { ok: true, demo: 'ready', url: demoAddress(shopDomain, key) }
  }

  return { list, previewLink }
}

export type TemplateAdminService = ReturnType<typeof createTemplateAdminService>
