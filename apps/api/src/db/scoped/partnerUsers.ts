import type { PartnerState } from '../schema/saas'
import type { ScopedSql } from './index'

export interface PartnerCallerRow {
  id: string
  name: string
  email: string
  role_key: string
  partner_id: string
  partner_name: string
  product_name: string | null
  state: PartnerState
  sent_back_reason: string | null
  portal_host: string | null
}

/** An active partner user of a partner that is not closed, with what `me` shows of the partner. */
export const selectPartnerCaller = async (tx: ScopedSql, partnerUserId: string): Promise<PartnerCallerRow | null> => {
  const rows = await tx<PartnerCallerRow[]>`
    select u.id, u.name, u.email, u.role_key, p.id as partner_id, p.name as partner_name, p.product_name,
           p.state, p.sent_back_reason, d.host as portal_host
    from partner_user u
    join partner p on p.id = u.partner_id
    left join partner_domain d on d.partner_id = p.id and d.kind = 'portal'
    where u.id = ${partnerUserId} and u.status = 'active' and p.state <> 'closed'
  `
  return rows[0] ?? null
}

export const partnerOfUser = async (tx: ScopedSql, partnerUserId: string): Promise<string | null> => {
  const rows = await tx<{ partner_id: string }[]>`select partner_id from partner_user where id = ${partnerUserId}`
  return rows[0]?.partner_id ?? null
}
