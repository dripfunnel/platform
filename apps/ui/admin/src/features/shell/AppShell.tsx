import { getRouteApi, Outlet, useRouter } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { messages } from '../../messages'
import { ExportWatcher } from '../activity/ExportWatcher'
import { useSessionsVersion } from '../impersonate/sessionEvents'
import { SessionStrip } from '../impersonate/SessionStrip'
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
  const router = useRouter()
  const sessionsVersion = useSessionsVersion()
  // A session started or ended here moves the badge and the page under it at once.
  useEffect(() => {
    if (sessionsVersion > 0) void router.invalidate()
  }, [sessionsVersion, router])

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
            <SessionStrip caller={me.role} meName={me.name} />
            <Outlet />
          </div>
        </main>
      </div>
      <NavDrawer open={menuOpen} onClose={() => setMenuOpen(false)}>
        <SideNav rows={rows} badges={badges} variant="drawer" onNavigate={() => setMenuOpen(false)} />
      </NavDrawer>
      <ExportWatcher />
    </div>
  )
}
