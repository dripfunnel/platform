import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { AppState } from 'react-native'
import { loadBadges, loadPerson, loadStoreState, loadTheme, type Badges, type Person, type StoreState } from '../../api/shell'
import type { ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { seatOf, type Seat } from '../../nav'
import type { Acting } from '../../session/sessionStore'
import { setMode } from '@dripfunnel/mobile-shared/theme'
import { useScenario, type RoleScenario } from '../states/scenario'
import { useOnline } from './connection'

export type Shell = {
  acting: Acting
  seat: Seat | null
  person: Person | null
  badges: Badges | null
  state: StoreState | null
  online: boolean
  refresh: () => void
}

type Loaded = { key: string; person: Person | null; badges: Badges | null; state: StoreState | null }

const Context = createContext<Shell | null>(null)

export const useShell = (): Shell => {
  const shell = useContext(Context)
  if (!shell) throw new Error('useShell needs a ShellDataProvider above it')
  return shell
}

const roleScenarios: Record<Exclude<RoleScenario, 'real'>, { role: string; tier: string | null }> = {
  owner: { role: 'owner', tier: null },
  manager: { role: 'manager', tier: null },
  staff: { role: 'staff', tier: null },
  supplierStock: { role: 'supplier-member', tier: 'vendor-stock' },
  supplierCatalogue: { role: 'supplier-member', tier: 'vendor-catalogue' },
  supplierOrders: { role: 'supplier-member', tier: 'vendor-orders-fulfil' },
  supplierAdmin: { role: 'supplier-admin', tier: 'vendor-orders-fulfil' },
}

// Each read stands alone: a failed one draws less (no badge, no banner), never a broken shell (FIRST-RELEASE.md §3).
const settled = <T,>(read: Promise<T>): Promise<T | null> => read.catch(() => null)

// With no acting store (signed out, or choosing one) it reads nothing and hands down no shell.
export function ShellDataProvider({ acting, client, children }: { acting: Acting | null; client: ApiClient; children: ReactNode }) {
  const scenario = useScenario()
  const online = useOnline()
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [round, setRound] = useState(0)
  const refresh = useCallback(() => setRound((n) => n + 1), [])

  const storeKey = acting ? `${acting.storeId}/${acting.supplierId ?? ''}` : null
  // What was read for another store is never handed to this one, not even for a render.
  const data = loaded !== null && loaded.key === storeKey ? loaded : null
  const person = data?.person ?? null
  const badges = data?.badges ?? null
  const state = data?.state ?? null

  useEffect(() => {
    let current = true
    if (storeKey === null) {
      setTheme('light')
      return
    }
    void Promise.all([settled(loadPerson(client)), settled(loadBadges(client)), settled(loadStoreState(client)), settled(loadTheme(client))]).then(([nextPerson, nextBadges, nextState, nextTheme]) => {
      if (!current) return
      setLoaded({ key: storeKey, person: nextPerson, badges: nextBadges, state: nextState })
      if (nextTheme) setTheme(nextTheme)
    })
    return () => {
      current = false
    }
  }, [client, storeKey, round])

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => next === 'active' && refresh())
    return () => subscription.remove()
  }, [refresh])

  // The account's saved choice of light or dark (ui/README.md §4); signing out goes back to light.
  const mode = storeKey === null ? 'light' : scenario.mode === 'real' ? theme : scenario.mode
  useEffect(() => {
    setMode(mode)
  }, [mode])

  const effective = useMemo<Acting | null>(() => (acting && scenario.role !== 'real' ? { ...acting, ...roleScenarios[scenario.role] } : acting), [acting, scenario.role])
  const value = useMemo<Shell | null>(
    () => (effective ? { acting: effective, seat: seatOf(effective), person, badges, state, online, refresh } : null),
    [effective, person, badges, state, online, refresh],
  )
  return <Context.Provider value={value}>{children}</Context.Provider>
}
