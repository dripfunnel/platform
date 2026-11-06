import { isApiError } from '@dripfunnel/shared/graphql'
import { ConfirmDialog, Strip, Toast, usePolling } from '@dripfunnel/shared/ui'
import { useState } from 'react'
import { loadSupportBanner, type StoreState } from '../../api/shell'
import { answerSupportWrite, issueSupportWriteCode, redeemSupportWriteCode, requestSupportWrite } from '../../api/support'
import { endSupportSession, extendSupportSession } from '../../api/supportSession'
import { partnerConsoleUrl } from '../../partnerConsole'
import { fill, formatWait, messages } from '../../messages'

const words = messages.shell.banners.support

type Banner = NonNullable<StoreState['support']>
type Asking = 'allow' | 'give' | 'ask' | 'enter' | 'end'

const secondsUntil = (iso: string, now: Date) => Math.max(0, Math.round((new Date(iso).getTime() - now.getTime()) / 1000))

const Said = ({ title, body }: { title: string; body: string }) => (
  <>
    <strong>{title}</strong> {body}
  </>
)

const Button = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <button type="button" className="df-strip-button" onClick={onClick}>
    {label}
  </button>
)

// ACCESS.md §8 and the DF Store Prototype's Partner support states: the agent's ask, the merchant's
// Allow / Deny, and the write code beside them (not drawn there). `canDecide`: an Owner's or a Manager's.
export const SupportBanner = ({ support: loaded, now, inSupport, canDecide, manager, storeName }: { support: Banner; now: Date; inSupport: boolean; canDecide: boolean; manager: boolean; storeName: string }) => {
  // Polled, so the agent's ask reaches the merchant and the answer reaches the agent without a reload.
  const polled = usePolling(loaded.sessionId ? async () => ({ support: await loadSupportBanner() }) : null)
  const support = polled.value ? polled.value.support : loaded
  const [asking, setAsking] = useState<Asking | null>(null)
  const [given, setGiven] = useState<{ code: string; expiresAt: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  if (!support) return null

  const name = support.agentFirstName
  const time = formatWait(secondsUntil(support.endsAt, now))
  const writes = support.access === 'write'
  const sessionId = support.sessionId
  const request = writes ? null : support.writeRequest
  const pending = request?.state === 'pending'
  const close = () => {
    setAsking(null)
    setError(null)
  }
  const act = async (run: () => Promise<void>, done: string | null, refusal: (e: unknown) => string) => {
    setError(null)
    try {
      await run()
      setAsking(null)
      if (done) setToast(done)
      polled.refresh()
    } catch (e) {
      setError(refusal(e))
    }
  }
  const notPending = (e: unknown) => (isApiError(e, 'NOT_PENDING') ? words.notPending : words.failed)

  const give = () =>
    act(async () => {
      if (sessionId) setGiven(await issueSupportWriteCode(sessionId))
    }, null, (e) => (isApiError(e, 'NOT_PENDING') ? words.ended : words.failed))
  const enter = (code: string) =>
    act(() => redeemSupportWriteCode(code), words.codeUsed, (e) =>
      isApiError(e, 'SESSION_ENDED') ? words.ended : isApiError(e, 'CODE_INVALID') || isApiError(e, 'INVALID_INPUT') ? words.codeWrong : words.failed,
    )
  const ask = (note: string) => act(() => requestSupportWrite(note), words.askedToast, (e) => (isApiError(e, 'SESSION_ENDED') ? words.ended : words.failed))
  const answer = (allow: boolean) => act(async () => {
      if (sessionId) await answerSupportWrite(sessionId, allow)
    }, allow ? words.allowed : fill(words.denied, { name }), notPending)
  // Deny has no dialog (the prototype answers it at once), so its refusal is a toast.
  const deny = async () => {
    try {
      if (sessionId) await answerSupportWrite(sessionId, false)
      setToast(fill(words.denied, { name }))
      polled.refresh()
    } catch (e) {
      setToast(notPending(e))
    }
  }

  // ACCESS.md §8: once, by 30 minutes; the banner's next read shows the new end.
  const extend = async () => {
    const until = sessionId ? await extendSupportSession(sessionId).catch(() => null) : null
    setToast(until ? fill(words.extended, { time: formatWait(secondsUntil(until, new Date())) }) : words.extendFailed)
    polled.refresh()
  }

  // The agent's End now (ACCESS.md §8.3): the cookie then acts as nobody, so the agent goes back to the console.
  const endSession = async () => {
    setError(null)
    try {
      if (sessionId && (await endSupportSession(sessionId))) {
        window.location.assign(partnerConsoleUrl)
        return
      }
    } catch {
      // A request that never answered reads as not ended.
    }
    setError(words.endFailed)
  }

  const live = given && !writes && secondsUntil(given.expiresAt, now) > 0 ? given : null
  const body = (() => {
    if (writes) return support.allowedBy ? fill(words.writeBy, { by: support.allowedBy, time }) : fill(words.writeBody, { time })
    if (inSupport) return pending ? fill(words.asked, { time }) : request?.state === 'denied' ? fill(words.refused, { time }) : fill(words.body, { time })
    if (pending) return `${fill(words.asks, { name, note: request.note, time })}${canDecide ? '' : ` ${words.asksOthers}`}`
    return live ? fill(words.given, { name, code: live.code, time: formatWait(secondsUntil(live.expiresAt, now)) }) : fill(words.body, { time })
  })()
  const actions = (() => {
    if (!sessionId) return []
    const own = [
      ...(support.extendable ? [<Button key="extend" label={words.extend} onClick={() => void extend()} />] : []),
      <Button key="end" label={words.end} onClick={() => setAsking('end')} />,
    ]
    if (inSupport && writes) return own
    if (inSupport) return [...(pending ? [] : [<Button key="ask" label={words.ask} onClick={() => setAsking('ask')} />]), <Button key="enter" label={words.enterCode} onClick={() => setAsking('enter')} />, ...own]
    if (writes) return []
    if (!canDecide) return []
    if (pending) return [<Button key="deny" label={words.deny} onClick={() => void deny()} />, <Button key="allow" label={words.allow} onClick={() => setAsking('allow')} />]
    return [<Button key="give" label={words.giveCode} onClick={() => setAsking('give')} />]
  })()

  return (
    <>
      <Strip tone="warning" action={actions.length > 0 ? <span className="df-strip-actions">{actions}</span> : undefined}>
        <Said title={fill(writes ? words.writeTitle : words.title, { partner: support.partnerName, name })} body={body} />
      </Strip>
      {canDecide && !inSupport && (
        <>
          <ConfirmDialog
            open={asking === 'allow'}
            title={fill(words.allowTitle, { partner: support.partnerName })}
            target={request?.note ?? ''}
            consequence={fill(words.allowBody, { name, time })}
            notes={manager ? [words.allowManager] : []}
            confirmLabel={words.allowGo}
            cancelLabel={words.cancel}
            error={error}
            onConfirm={() => void answer(true)}
            onCancel={close}
          />
          <ConfirmDialog
            open={asking === 'give'}
            title={fill(words.giveTitle, { partner: support.partnerName })}
            target={fill(words.giveTarget, { name })}
            consequence={fill(words.giveBody, { name })}
            notes={manager ? [words.giveManager] : []}
            confirmLabel={words.giveGo}
            cancelLabel={words.cancel}
            error={error}
            onConfirm={() => void give()}
            onCancel={close}
          />
        </>
      )}
      {inSupport && (
        <>
          <ConfirmDialog
            open={asking === 'ask'}
            title={words.askTitle}
            target={fill(words.enterTarget, { store: storeName })}
            consequence={words.askBody}
            reason={{ label: words.askLabel, hint: words.askHint }}
            confirmLabel={words.askGo}
            cancelLabel={words.cancel}
            error={error}
            onConfirm={(note) => void ask(note ?? '')}
            onCancel={close}
          />
          <ConfirmDialog
            open={asking === 'end'}
            title={words.endTitle}
            target={fill(words.enterTarget, { store: storeName })}
            consequence={words.endBody}
            confirmLabel={words.end}
            cancelLabel={words.cancel}
            danger
            error={error}
            onConfirm={() => void endSession()}
            onCancel={close}
          />
          <ConfirmDialog
            open={asking === 'enter'}
            title={words.enterTitle}
            target={fill(words.enterTarget, { store: storeName })}
            consequence={words.enterBody}
            input={{ label: words.codeLabel, type: 'text', initial: '', placeholder: '123456', error: (v) => (/^\d{6}$/.test(v.trim()) ? null : words.codeHint) }}
            confirmLabel={words.enterGo}
            cancelLabel={words.cancel}
            error={error}
            onConfirm={(_, value) => void enter(value ?? '')}
            onCancel={close}
          />
        </>
      )}
      <Toast message={toast} onDone={() => setToast(null)} />
    </>
  )
}
