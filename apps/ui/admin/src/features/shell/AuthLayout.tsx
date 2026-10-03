import { Outlet } from '@tanstack/react-router'
import { BannerStack } from './BannerStack'
import { EnvironmentBanner, environmentFor } from '@dripfunnel/shared/ui'
import { messages } from '../../messages'
import '@dripfunnel/shared/ui/shell.css'

// Signed-out screens keep the environment strip, as the prototype's sign-in does.
export const AuthLayout = () => {
  const environment = environmentFor(window.location.hostname)
  return (
    <div className="df-auth">
      <BannerStack>
        <EnvironmentBanner environment={environment} words={messages.shell.environment[environment]} />
      </BannerStack>
      <Outlet />
    </div>
  )
}
