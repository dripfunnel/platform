// What a read-only check of a Google Maps browser key finds (#1612; THIRD-PARTY-ACCESS §2.12): the key is usable, Google
// couldn't be asked, or which part it refused. The adapter is integrations/googleMaps; the services take it as a function.

/** Which part Google refused, for the panel to name. */
export type MapsKeyProblem = 'invalid' | 'geocoding_disabled' | 'restricted' | 'other'
export type MapsKeyCheck = { status: 'ok' } | { status: 'unavailable' } | { status: 'rejected'; problem: MapsKeyProblem }
