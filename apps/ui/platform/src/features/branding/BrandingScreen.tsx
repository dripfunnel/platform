import { ConfirmDialog, Toast, useScreenState } from '@dripfunnel/shared/ui'
import { getRouteApi, useRouter } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import { checkContrast, hexColour, publishBranding, type ContrastReport } from '../../api/branding'
import { harnessEnabled } from '../../harness'
import { fill, messages } from '../../messages'
import { draftOf, isDirty, publishConsequence, refusalText, type BrandDraft } from './brandDraft'
import { Branding, BrandingError, BrandingLoading } from './Branding'
import type { PreviewDevice, PreviewMode, PreviewScreen } from './BrandPreview'
import { brandingStates } from './brandingHarness'

const brandingRoute = getRouteApi('/_app/branding')
const shellRoute = getRouteApi('/_app')

// Waits for a pause in typing before asking the API to check the colours again.
const contrastDelayMs = 300

export const BrandingScreen = () => {
  const branding = brandingRoute.useLoaderData()
  const { tab = 'look' } = brandingRoute.useSearch()
  const { me } = shellRoute.useLoaderData()
  const forced = useScreenState(brandingStates, harnessEnabled)
  const router = useRouter()
  const original = draftOf(branding)
  const [draft, setDraft] = useState<BrandDraft>(original)
  const [contrast, setContrast] = useState<ContrastReport>(branding.contrast)
  const [confirming, setConfirming] = useState(forced === 'confirm' && branding.permission.allowed)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [screen, setScreen] = useState<PreviewScreen>('signin')
  const [device, setDevice] = useState<PreviewDevice>('desktop')
  const [mode, setMode] = useState<PreviewMode>('light')
  const clearToast = useCallback(() => setToast(null), [])

  // A newly published look from the loader resets the draft to it.
  const originalKey = JSON.stringify(original)
  useEffect(() => {
    setDraft(JSON.parse(originalKey) as BrandDraft)
    setContrast(JSON.parse(JSON.stringify(branding.contrast)) as ContrastReport)
  }, [originalKey])

  // The contrast report is the API's: asked again as colours change, never worked out here. A reply for
  // colours no longer in the draft is dropped.
  const { primary, accent } = draft.look
  useEffect(() => {
    if (!hexColour.test(primary) || !hexColour.test(accent)) return
    let current = true
    const timer = setTimeout(() => {
      checkContrast(primary, accent).then(
        (report) => current && setContrast(report),
        () => undefined,
      )
    }, contrastDelayMs)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [primary, accent])

  const publish = () => {
    setConfirming(false)
    setBusy(true)
    publishBranding(me.partner.id, draft, me.role)
      .then(async (result) => {
        setBusy(false)
        if (!result.ok) {
          if (result.reason === 'CONTRAST_FAILS') checkContrast(draft.look.primary, draft.look.accent).then(setContrast, () => undefined)
          return setToast(fill(messages.branding.toasts.refused, { reason: refusalText(result) }))
        }
        setToast(messages.branding.toasts.published)
        await router.invalidate()
      })
      .catch(() => {
        setBusy(false)
        setToast(messages.branding.toasts.failed)
      })
  }

  return (
    <>
      <Branding
        me={me}
        branding={branding}
        draft={draft}
        original={original}
        contrast={contrast}
        tab={tab}
        forced={forced}
        busy={busy}
        preview={{ screen, device, mode, onScreen: setScreen, onDevice: setDevice, onMode: setMode }}
        onDraft={setDraft}
        onDiscard={() => setDraft(original)}
        onPublish={() => setConfirming(true)}
        onReload={() => void router.invalidate()}
      />
      <ConfirmDialog
        open={confirming && (isDirty(draft, original) || forced === 'confirm')}
        title={messages.branding.dialog.title}
        target={draft.look.productName}
        consequence={publishConsequence(branding.affects)}
        confirmLabel={messages.branding.dialog.confirm}
        cancelLabel={messages.store.cancel}
        onConfirm={publish}
        onCancel={() => setConfirming(false)}
      />
      <Toast message={toast} onDone={clearToast} />
    </>
  )
}

export const BrandingPending = () => {
  const { me } = brandingRoute.useRouteContext()
  return <BrandingLoading product={me.partner.product} />
}

export const BrandingRouteError = () => {
  const router = useRouter()
  const { me } = brandingRoute.useRouteContext()
  return <BrandingError product={me.partner.product} onRetry={() => void router.invalidate()} />
}
