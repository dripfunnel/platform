import * as Location from 'expo-location'
import { useCallback, useEffect, useState } from 'react'
import { AppState } from 'react-native'
import { acceptDisclosure, disclosureAccepted } from '../../location/disclosure'
import { goOffline, goOnline } from '../../location/online'
import { isTracking } from '../../location/tracking'
import { useSession } from '../../session/SessionContext'
import { useAction } from '../common/useAction'

/**
 * Whether the rider is Online. The position task runs exactly while they are, so the task is what is asked: a rider who closed the app and came back is still online.
 * `denied` is the permission-refused state, cleared once location is allowed in Settings. `disclosing` is the disclosure the rider sees
 * before location is first asked for: Continue goes on to the permission, Not now leaves them Offline (docs/mobile-app/delivery/FIRST-RELEASE.md §2).
 */
export function useOnline(pickedUp: boolean) {
  const { client, host } = useSession()
  const [online, setOnlineNow] = useState<boolean | null>(null)
  const [denied, setDenied] = useState(false)
  const [disclosing, setDisclosing] = useState(false)
  const action = useAction()

  useEffect(() => {
    let live = true
    isTracking().then(
      (running) => live && setOnlineNow(running),
      () => live && setOnlineNow(false),
    )
    return () => {
      live = false
    }
  }, [])

  const recheck = useCallback(async () => {
    if (denied && (await Location.getForegroundPermissionsAsync()).granted) setDenied(false)
  }, [denied])

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => state === 'active' && void recheck())
    return () => subscription.remove()
  }, [recheck])

  const start = async () => {
    const done = await action.run(() => goOnline(client, pickedUp))
    if (!done) return
    setDenied(done.value === 'denied')
    if (done.value === 'online') setOnlineNow(true)
  }

  const turnOn = async () => {
    if (await disclosureAccepted(host)) return start()
    setDisclosing(true)
  }

  const continueDisclosure = async () => {
    // A keystore that won't keep it shows the disclosure again next time; the rider is not stopped for it.
    await acceptDisclosure(host).catch(() => undefined)
    setDisclosing(false)
    await start()
  }

  const turnOff = async () => {
    const done = await action.run(() => goOffline(client, pickedUp))
    if (done) setOnlineNow(false)
  }

  return { online, denied, disclosing, busy: action.busy, error: action.error, clearError: action.clear, turnOn, turnOff, recheck, continueDisclosure, declineDisclosure: () => setDisclosing(false) }
}
