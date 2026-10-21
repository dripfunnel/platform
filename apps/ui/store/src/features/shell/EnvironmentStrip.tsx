import { EnvironmentBanner, environmentFor } from '@dripfunnel/shared/ui'
import { messages } from '../../messages'

// Nothing in production; dev, feature and local hosts get the shared grey strip (#65).
export const EnvironmentStrip = () => {
  const environment = environmentFor(window.location.hostname)
  if (environment === 'prod') return null
  return <EnvironmentBanner environment={environment} words={messages.shell.environment[environment]} />
}
