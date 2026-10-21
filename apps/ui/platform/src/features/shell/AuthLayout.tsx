import '@dripfunnel/shared/ui/shell.css'
import { Outlet } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { EnvironmentStrip } from './EnvironmentStrip'

// Signed-out screens keep the environment strip where there is one; so does the shell's load error.
export const AuthLayout = ({ children }: { children?: ReactNode }) => (
  <div className="df-auth">
    <div className="df-banners">
      <EnvironmentStrip />
    </div>
    {children ?? <Outlet />}
  </div>
)
