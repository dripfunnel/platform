import type { Step } from '../../api/delivery'

/** One step as the rider takes it: its time, and a key that makes a resend of it do nothing twice (docs/api/DELIVERY.md §4). */
export const newStep = (): Step => ({ at: new Date().toISOString(), key: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}` })
