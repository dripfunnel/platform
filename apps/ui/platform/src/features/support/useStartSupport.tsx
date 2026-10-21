import { Toast } from '@dripfunnel/shared/ui'
import { useRouter } from '@tanstack/react-router'
import { useCallback, useState } from 'react'
import { findSupportTarget, loadMySupportSession, type SupportSession, type SupportTarget } from '../../api/support'
import type { Me } from '../../api/me'
import { fill, messages } from '../../messages'
import { StartSupportDialog } from './StartSupportDialog'

const words = messages.support

// One start flow for Support's Users tab and a store's Support tab (§12.2), so both say and check the same.
export const useStartSupport = (me: Me) => {
  const router = useRouter()
  const [subject, setSubject] = useState<{ target: SupportTarget; mine: SupportSession | null } | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const clearToast = useCallback(() => setToast(null), [])

  const open = (target: SupportTarget, mine: SupportSession | null) => setSubject({ target, mine })

  // From a store's people: that user's row in that store, with the API's verdict, and the caller's own open session.
  const openFor = (person: { id: string; email: string }, storeId: string) =>
    Promise.all([findSupportTarget(person, storeId), loadMySupportSession()])
      .then(([target, mine]) => (target ? open(target, mine) : setToast(words.refusals.NOT_FOUND)))
      .catch(() => setToast(words.toasts.failed))

  const element = (
    <>
      <StartSupportDialog
        target={subject?.target ?? null}
        mine={subject?.mine ?? null}
        partner={me.partner.name}
        me={me.name}
        onClose={() => setSubject(null)}
        onChanged={() => void router.invalidate()}
        onStarted={(name, blocked) => setToast(blocked ? words.toasts.popupBlocked : fill(words.toasts.started, { name }))}
      />
      <Toast message={toast} onDone={clearToast} />
    </>
  )

  return { open, openFor, say: setToast, element }
}
