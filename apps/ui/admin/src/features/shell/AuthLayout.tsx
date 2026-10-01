import { Outlet } from '@tanstack/react-router'
import { BannerStack } from './BannerStack'
import { environmentFor } from './environment'
import { EnvironmentBanner } from './EnvironmentBanner'
import '@dripfunnel/shared/ui/shell.css'

// Signed-out screens keep the environment strip, as the prototype's sign-in does.
export const AuthLayout = () => (
  <div className="df-auth">
    <BannerStack>
      <EnvironmentBanner environment={environmentFor(window.location.hostname)} />
    </BannerStack>
    <Outlet />
  </div>
)
