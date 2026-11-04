// The switch the Owner was making when they left for Stripe's card page, so the pop-up comes back as it was.
const key = 'df.billing.switch'
export interface PendingSwitch {
  plan: string
  interval: 'MONTH' | 'YEAR'
}

export const rememberSwitch = (pending: PendingSwitch) => {
  try {
    sessionStorage.setItem(key, JSON.stringify(pending))
  } catch {
    // Without storage the Owner just picks the plan again.
  }
}

export const takeSwitch = (): PendingSwitch | null => {
  try {
    const raw = sessionStorage.getItem(key)
    sessionStorage.removeItem(key)
    const found: unknown = raw ? JSON.parse(raw) : null
    if (typeof found !== 'object' || found === null || !('plan' in found) || !('interval' in found)) return null
    return typeof found.plan === 'string' && (found.interval === 'MONTH' || found.interval === 'YEAR') ? { plan: found.plan, interval: found.interval } : null
  } catch {
    return null
  }
}
