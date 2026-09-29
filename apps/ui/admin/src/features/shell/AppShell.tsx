import { getRouteApi, Outlet } from '@tanstack/react-router'
import { useState } from 'react'
import { messages } from '../../messages'
import { navFor } from '../../nav'
import { AppHeader } from './AppHeader'
import { BannerStack } from './BannerStack'
import { environmentFor } from './environment'
import { EnvironmentBanner } from './EnvironmentBanner'
import { NavDrawer } from './NavDrawer'
import './shell.css'
import { SideNav } from './SideNav'

const shellRoute = getRouteApi('/_app')

export const AppShell = () => {
  const { me, badges } = shellRoute.useLoaderData()
  const [menuOpen, setMenuOpen] = useState(false)
  const environment = environmentFor(window.location.hostname)
  const rows = navFor(me.role)

  return (
    <div className="df-shell">
      <a href="#main" className="df-skip-link">
        {messages.shell.skipToContent}
      </a>
      <AppHeader me={me} environment={environment} menuOpen={menuOpen} onOpenMenu={() => setMenuOpen(true)} />
      <BannerStack>
        <EnvironmentBanner environment={environment} />
      </BannerStack>
      <div className="df-shell-body">
        <SideNav rows={rows} badges={badges} variant="bar" />
        <main id="main" className="df-shell-main" tabIndex={-1}>
          <div className="df-shell-content">
            <Outlet />
          </div>
        </main>
      </div>
      <NavDrawer open={menuOpen} onClose={() => setMenuOpen(false)}>
        <SideNav rows={rows} badges={badges} variant="drawer" onNavigate={() => setMenuOpen(false)} />
      </NavDrawer>
    </div>
  )
}
