import { isHarnessEnabled } from '@dripfunnel/shared/ui'

// On under `vite dev`, and in a build only with VITE_STATE_HARNESS=1 (ui/README.md §6).
export const harnessEnabled = isHarnessEnabled(import.meta.env)

const text = (value: unknown) => (typeof value === 'string' ? value : undefined)

/** The harness's seat and standing (?as=, ?store=) carried to the next screen, so a click-through stays in the sample. */
export const harnessSearch = (prev: Record<string, unknown>, state?: string) => (harnessEnabled ? { as: text(prev['as']), store: text(prev['store']), state } : {})
