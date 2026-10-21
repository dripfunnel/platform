import { Outlet } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { BannerStack } from './BannerStack'
import { EnvironmentBanner, environmentFor } from '@dripfunnel/shared/ui'
import { messages } from '../../messages'
import '@dripfunnel/shared/ui/shell.css'

// Signed-out screens keep the environment strip, as the prototype's sign-in does; so does the shell's load error.
export const AuthLayout = ({ children }: { children?: ReactNode }) => {
  const environment = environmentFor(window.location.hostname)
  return (
    <div className="df-auth">
      <BannerStack>
        <EnvironmentBanner environment={environment} words={messages.shell.environment[environment]} />
      </BannerStack>
      {children ?? <Outlet />}
    </div>
  )
}
