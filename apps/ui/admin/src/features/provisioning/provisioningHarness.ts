// States (?state=): loading, empty, error, denied, confirm. `denied` asks as Support, who may
// retry but not undo, so a refusal shows beside a live control; a role with no Provisioning
// menu (?state=readonly) gets the page's no-access view. ?pace=fast|normal|slow sets how long
// the sample Workflow takes over each step, so a run can be watched or skipped through.
export const provisioningStates = ['loading', 'empty', 'error', 'denied', 'confirm'] as const
export type ProvisioningScreenState = (typeof provisioningStates)[number]
