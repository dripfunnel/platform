import { ExportWatcher, exportJob, NavDrawer, SideNav, useNow } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/shell.css'
import { getRouteApi, Outlet } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { loadCatalogExport } from '../../api/imports'
import { currentBrand } from '../../brand/current'
import { messages } from '../../messages'
import { ImportWatcher } from '../imports/ImportWatcher'
import { AppHeader } from './AppHeader'
import { EnvironmentStrip } from './EnvironmentStrip'
import { navRowsFor } from './navWords'
import { StoreBanners } from './StoreBanners'
import './store.css'
import { trialDaysLeft } from './trial'

const shellRoute = getRouteApi('/_app')

export const AppShell = () => {
  const { me, acting, seat, stores, state, badges } = shellRoute.useLoaderData()
  const [menuOpen, setMenuOpen] = useState(false)
  const now = new Date(useNow(60_000))
  const brand = currentBrand()
  const owner = seat.side === 'merchant' && seat.role === 'owner'
  const rows = navRowsFor(seat, badges, owner && state?.status === 'trial' ? trialDaysLeft(state.trialEndsAt, now) : null)
  const current = stores.find((c) => c.store.id === acting.store.id && (c.seller?.id ?? null) === (acting.seller?.id ?? null)) ?? { membershipId: '', store: acting.store, role: acting.role, tier: acting.tier, seller: acting.seller }
  const words = messages.shell
  const seatKey = `${acting.store.id}:${acting.seller?.id ?? ''}`
  // An export started in one store or supplier seat is never shown in another.
  useEffect(() => () => exportJob.set(null), [seatKey])

  return (
    <div className="df-shell df-store-shell">
      <a href="#main" className="df-skip-link">
        {words.skipToContent}
      </a>
      <AppHeader me={me} seat={seat} current={current} stores={stores} brand={brand} menuOpen={menuOpen} onOpenMenu={() => setMenuOpen(true)} />
      <div className="df-banners">
        <EnvironmentStrip />
        <StoreBanners seat={seat} acting={acting} state={state} brand={brand} />
      </div>
      <div className="df-shell-body">
        <SideNav rows={rows} variant="bar" label={words.navLabel} footer={null} />
        <main id="main" className="df-shell-main" tabIndex={-1}>
          <div className="df-shell-content">
            <Outlet />
          </div>
        </main>
      </div>
      {acting.permissions.includes('catalog.import') && <ImportWatcher key={seatKey} />}
      {acting.permissions.includes('catalog.read') && <ExportWatcher load={loadCatalogExport} toast={messages.imports.export.ready} />}
      <NavDrawer open={menuOpen} onClose={() => setMenuOpen(false)} label={words.navLabel} closeLabel={words.closeMenu}>
        <SideNav rows={rows} variant="drawer" label={words.navLabel} footer={null} onNavigate={() => setMenuOpen(false)} />
      </NavDrawer>
    </div>
  )
}
