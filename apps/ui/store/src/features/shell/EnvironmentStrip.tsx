import { EnvironmentBanner, environmentFor } from '@dripfunnel/shared/ui'
import { messages } from '../../messages'

const nonProd = /(^|\.)(localhost|actuateminds\.com)$|^(127\.0\.0\.1|\[?::1\]?)$/

// Portal hosts are open-ended (house and custom domains), so only the closed set of non-prod hosts
// gets the strip; environmentFor's "unknown is feature" default would flag every prod store host.
export const isNonProdHost = (hostname: string) => nonProd.test(hostname.toLowerCase())

export const EnvironmentStrip = () => {
  const hostname = window.location.hostname
  const environment = environmentFor(hostname)
  if (environment === 'prod' || !isNonProdHost(hostname)) return null
  return <EnvironmentBanner environment={environment} words={messages.shell.environment[environment]} />
}
