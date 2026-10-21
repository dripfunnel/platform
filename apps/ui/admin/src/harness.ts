import { isHarnessEnabled } from '@dripfunnel/shared/ui'

// On under `vite dev`, and in a build only with VITE_STATE_HARNESS=1 (README "Screen states").
export const harnessEnabled = isHarnessEnabled(import.meta.env)
