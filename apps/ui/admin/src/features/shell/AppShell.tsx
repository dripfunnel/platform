import { EnvironmentBanner, environmentFor, ExportWatcher, NavDrawer, navView, SideNav } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/shell.css'
import { getRouteApi, Outlet, useRouter, useRouterState } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { loadActivityExport } from '../../api/activity'
import { messages } from '../../messages'
import { useSessionsVersion } from '../impersonate/sessionEvents'
import { SessionStrip } from '../impersonate/SessionStrip'
import { navFor } from '../../nav'
import { NeedsLaptop } from '../common/NeedsLaptop'
import { phoneView } from '../common/phoneView'
import { usePhone } from '../common/usePhone'
import { FindStore } from '../stores/FindStore'
import { AppHeader } from './AppHeader'
import { BannerStack } from './BannerStack'
import { navWords } from './navWords'

const shellRoute = getRouteApi('/_app')

export const AppShell = () => {
  const { me, badges } = shellRoute.useLoaderData()
  const [menuOpen, setMenuOpen] = useState(false)
  const environment = environmentFor(window.location.hostname)
  const rows = navView(navFor(me.role), badges, navWords)
  const router = useRouter()
  const sessionsVersion = useSessionsVersion()
  const routeId = useRouterState({ select: (state) => state.matches.at(-1)?.routeId })
  const phone = usePhone()
  const view = phone ? phoneView(routeId) : null
  // Pages a phone skipped loading (the Dashboard, Stores) load once the screen widens.
  const wasPhone = useRef(phone)
  useEffect(() => {
    if (wasPhone.current && !phone) void router.invalidate()
    wasPhone.current = phone
  }, [phone, router])
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
        <EnvironmentBanner environment={environment} words={messages.shell.environment[environment]} />
      </BannerStack>
      <div className="df-shell-body">
        <SideNav rows={rows} variant="bar" label={messages.shell.navLabel} footer={messages.shell.navFooter} />
        <main id="main" className="df-shell-main" tabIndex={-1}>
          <div className="df-shell-content">
            <SessionStrip caller={me.role} meName={me.name} />
            {view === 'find' ? <FindStore /> : view === 'laptop' ? <NeedsLaptop /> : <Outlet />}
          </div>
        </main>
      </div>
      <NavDrawer open={menuOpen} onClose={() => setMenuOpen(false)} label={messages.shell.navLabel} closeLabel={messages.shell.closeMenu}>
        <SideNav rows={rows} variant="drawer" label={messages.shell.navLabel} footer={messages.shell.navFooter} onNavigate={() => setMenuOpen(false)} />
      </NavDrawer>
      <ExportWatcher load={loadActivityExport} toast={messages.activity.export.toast} />
    </div>
  )
}
