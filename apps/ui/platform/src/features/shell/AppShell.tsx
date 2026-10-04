import { ExportWatcher, NavDrawer, navView, SideNav } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/shell.css'
import { getRouteApi, Outlet } from '@tanstack/react-router'
import { useState } from 'react'
import { exportKindById, loadExport } from '../../api/exports'
import { messages } from '../../messages'
import { navFor } from '../../nav'
import { AppHeader } from './AppHeader'
import { EnvironmentStrip } from './EnvironmentStrip'
import { navWords } from './navWords'
import { PartnerBanners } from './PartnerBanners'

const shellRoute = getRouteApi('/_app')

export const AppShell = () => {
  const { me, facts, badges } = shellRoute.useLoaderData()
  const [menuOpen, setMenuOpen] = useState(false)
  const rows = navView(navFor(me.role), badges, navWords)
  const words = messages.shell
  const footer = <>{words.navFooter.before}<strong>{me.partner.product}</strong>{words.navFooter.after}</>

  return (
    <div className="df-shell">
      <a href="#main" className="df-skip-link">
        {words.skipToContent}
      </a>
      <AppHeader me={me} menuOpen={menuOpen} onOpenMenu={() => setMenuOpen(true)} />
      <div className="df-banners">
        <EnvironmentStrip />
        <PartnerBanners me={me} facts={facts} />
      </div>
      <div className="df-shell-body">
        <SideNav rows={rows} variant="bar" label={words.navLabel} footer={footer} />
        <main id="main" className="df-shell-main" tabIndex={-1}>
          <div className="df-shell-content">
            <Outlet />
          </div>
        </main>
      </div>
      <NavDrawer open={menuOpen} onClose={() => setMenuOpen(false)} label={words.navLabel} closeLabel={words.closeMenu}>
        <SideNav rows={rows} variant="drawer" label={words.navLabel} footer={footer} onNavigate={() => setMenuOpen(false)} />
      </NavDrawer>
      <ExportWatcher load={loadExport} toast={(id) => ({ stores: messages.stores.export.toast, activity: messages.activity.export.toast, report: messages.reports.export.toast })[exportKindById(id) ?? 'stores']} />
    </div>
  )
}
