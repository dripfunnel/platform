import { EnvironmentBanner, environmentFor } from '@dripfunnel/shared/ui'
import { messages } from '../../messages'

// Nothing in production (decided 2026-10-01 on #109): partner users see the console as the
// prototype draws it. Dev, feature and local hosts get the same grey strip as the admin console.
export const EnvironmentStrip = () => {
  const environment = environmentFor(window.location.hostname)
  if (environment === 'prod') return null
  return <EnvironmentBanner environment={environment} words={messages.shell.environment[environment]} />
}
