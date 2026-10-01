import '@dripfunnel/shared/ui/shell.css'
import { Outlet } from '@tanstack/react-router'
import { EnvironmentStrip } from './EnvironmentStrip'

// Signed-out screens keep the environment strip where there is one.
export const AuthLayout = () => (
  <div className="df-auth">
    <div className="df-banners">
      <EnvironmentStrip />
    </div>
    <Outlet />
  </div>
)
