export type Environment = 'production' | 'staging'

const productionHost = 'admin.dripfunnel.com'

// Only the production host says Production. Every other host (admin-dev.dripfunnel.com,
// feature environments on *.dripfunnel.ai, localhost) says Staging.
export const environmentFor = (hostname: string): Environment =>
  hostname === productionHost ? 'production' : 'staging'
