// A rollout's phases (SAAS §10), shared by the tick and the Admin API's resume.

/** Stores upgraded before anyone else's, chosen by a hash of the store and the rollout. */
export const canaryStores = 5
/** How far each wave reaches, in stores per hundred, after the canaries. */
export const wavePercents = [10, 25, 50, 100] as const
