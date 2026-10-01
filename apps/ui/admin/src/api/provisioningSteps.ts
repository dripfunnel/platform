// SAAS.md §5's steps, in order. A store using its own frontend runs only the first three, so a
// job carries its own list and the total always comes from it (decided on #43). A module of its
// own, so the samples can build their seeds from it without importing the loaders.
export const provisioningSteps = ['accountAndStore', 'defaults', 'hostnames', 'repo', 'storeConfig', 'hostingTarget', 'firstBuild', 'done'] as const
export type ProvisioningStep = (typeof provisioningSteps)[number]
