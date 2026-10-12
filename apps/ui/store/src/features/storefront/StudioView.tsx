import { isApiError } from '@dripfunnel/shared/graphql'
import { ConfirmDialog, Toast, usePhone } from '@dripfunnel/shared/ui'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { StorefrontOverview, StorefrontTemplate } from '../../api/storefront'
import { studioDevices, type DesignMessage, type StudioDevice, type StudioPages } from '../../api/studio'
import { currentBrand } from '../../brand/current'
import { fill, messages } from '../../messages'
import { discardRefusal, templateName } from './overviewView'
import { EditTextDialog } from './EditTextDialog'
import { StudioChat, type ChatRequest } from './StudioChat'
import { askRefusal, editModeMessage, frameAddress, frameMessage, frameOriginOf, openingPollMs, pageGroups, renewEveryMs, secondsPerPlace, textPageOf } from './studioView'
import type { StorefrontApi } from './storefrontApi'

const words = messages.storefront.studio

type Sandbox = { kind: 'opening' } | { kind: 'queued'; place: number } | { kind: 'ready' } | { kind: 'finishing' } | { kind: 'ended' } | { kind: 'failed'; text: string }
interface Session {
  id: string
  frameUrl: string
  origin: string
}

export interface StudioViewProps {
  overview: StorefrontOverview
  templates: readonly StorefrontTemplate[]
  storeName: string
  host: string | null
  api: StorefrontApi
  onExit: () => void
  onOverview: (next: StorefrontOverview) => void
}

const sandboxOf = (state: string, place: number | null): Sandbox =>
  state === 'ready' ? { kind: 'ready' } : state === 'queued' ? { kind: 'queued', place: place ?? 1 } : state === 'busy' ? { kind: 'finishing' } : state === 'unavailable' ? { kind: 'failed', text: words.sandbox.unavailable } : { kind: 'opening' }

/** The full-screen AI studio (PortalStorefront › studio; FIRST-RELEASE §14; storefront AI-STUDIO §1, §3, §8). */
export const StudioView = ({ overview, templates, storeName, host, api, onExit, onOverview }: StudioViewProps) => {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const phone = usePhone()
  const [session, setSession] = useState<Session | null>(null)
  const [sandbox, setSandbox] = useState<Sandbox>({ kind: 'opening' })
  const [opened, setOpened] = useState(0)
  const [chat, setChat] = useState<DesignMessage[]>([])
  const [earlier, setEarlier] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pages, setPages] = useState<StudioPages>({ product: null, content: [], custom: [] })
  const [languages, setLanguages] = useState<string[]>([])
  const [device, setDevice] = useState<StudioDevice>('desktop')
  const [pane, setPane] = useState<'chat' | 'preview'>('chat')
  const [framePath, setFramePath] = useState('/')
  const [shownPath, setShownPath] = useState('/')
  const [editing, setEditing] = useState(false)
  const [textKey, setTextKey] = useState<string | null>(null)
  const [discarding, setDiscarding] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const nameOf = useCallback((key: string) => templateName(templates, key), [templates])
  const notHere = useCallback(() => {
    setTextKey(null)
    setToast(words.edit.notHere)
  }, [])

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  // The chat's newest page; only the latest read lands.
  const chatAsk = useRef(0)
  const loadChat = useCallback(() => {
    const ask = ++chatAsk.current
    return api.loadDesignChat(null).then(
      (page) => {
        if (ask !== chatAsk.current) return
        setChat([...page.messages].reverse())
        setEarlier(page.next)
      },
      () => ask === chatAsk.current && setError(words.chat.loadFailed),
    )
  }, [api])

  // Opening: a new session, read again while the sandbox starts or queues; Reopen opens another.
  useEffect(() => {
    let current = true
    let timer: ReturnType<typeof setTimeout> | undefined
    setSandbox({ kind: 'opening' })
    const read = (id: string | null) =>
      api.loadStudioSession(id).then(
        (s) => {
          if (!current) return
          const origin = frameOriginOf(s.frameUrl, window.location.origin)
          if (!origin) return setSandbox({ kind: 'failed', text: words.sandbox.unavailable })
          setSession((was) => (was?.id === s.session ? was : { id: s.session, frameUrl: s.frameUrl, origin }))
          const next = sandboxOf(s.state, s.place)
          setSandbox(next)
          if (next.kind !== 'ready' && next.kind !== 'failed') timer = setTimeout(() => void read(s.session), openingPollMs)
        },
        (e: unknown) => current && setSandbox(isApiError(e, 'SESSION_ENDED') ? { kind: 'ended' } : { kind: 'failed', text: isApiError(e, 'NOT_CONNECTED') ? words.sandbox.notConnected : words.sandbox.unavailable }),
      )
    void read(null)
    void loadChat()
    void api.loadStudioPages().then((p) => current && setPages(p), () => undefined)
    void api.loadStudioLanguages().then((l) => current && setLanguages(l), () => undefined)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [api, opened, loadChat])

  // The session lives 5 minutes; a refused renewal ends it, a failed one is tried again next time (AI-STUDIO §8).
  const sessionId = session?.id ?? null
  useEffect(() => {
    if (!sessionId) return
    const timer = setInterval(() => {
      api.renewStudioSession(sessionId).catch((e: unknown) => {
        if (isApiError(e, 'SESSION_ENDED') || isApiError(e, 'FORBIDDEN')) setSandbox({ kind: 'ended' })
      })
    }, renewEveryMs)
    return () => clearInterval(timer)
  }, [api, sessionId])

  // Only the frame's own window, from the store's preview origin, is heard (AI-STUDIO §8).
  useEffect(() => {
    if (!session) return
    const onMessage = (event: MessageEvent) => {
      const message = frameMessage(event, session.origin, frameRef.current?.contentWindow ?? null)
      if (message?.type === 'df-studio:page') setShownPath(message.path)
      if (message?.type === 'df-studio:text' && editing) setTextKey(message.key)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [session, editing])

  const postEdit = (on: boolean) => {
    setEditing(on)
    if (session) frameRef.current?.contentWindow?.postMessage(editModeMessage(on), session.origin)
  }

  const locked = sandbox.kind !== 'ready' || busy
  const shownDevice = phone ? 'phone' : device
  const after = async () => {
    await loadChat()
    onOverview(await api.loadOverview())
  }
  const run = async (work: () => Promise<unknown>, refusal: (e: unknown) => string): Promise<boolean> => {
    if (locked) return false
    setBusy(true)
    setError(null)
    try {
      await work()
      await after()
      return true
    } catch (e) {
      if (isApiError(e, 'SESSION_ENDED')) setSandbox({ kind: 'ended' })
      setError(refusal(e))
      return false
    } finally {
      setBusy(false)
    }
  }
  // An accepted change reaches the frame by its own hot reload, so the frame's address never changes here (AI-STUDIO §4 step 5).
  const send = (request: ChatRequest) => run(() => api.askDesign({ ...request, page: shownPath, device: shownDevice }), askRefusal)
  const undo = (message: DesignMessage) => void run(() => api.undoDesignChange(message.id), askRefusal)
  const discard = () => {
    setDiscarding(false)
    void run(() => api.discardDraft(), discardRefusal)
  }
  const more = () => {
    if (!earlier) return
    void api.loadDesignChat(earlier).then(
      (page) => {
        setChat((was) => [...[...page.messages].reverse(), ...was])
        setEarlier(page.next)
      },
      () => setError(words.chat.loadFailed),
    )
  }

  const groups = useMemo(() => pageGroups(pages), [pages])
  const pageLabel = groups.flatMap((g) => g.items).find((i) => i.path === shownPath)?.label ?? shownPath
  const overlay = sandbox.kind === 'opening' ? words.sandbox.opening : sandbox.kind === 'queued' ? fill(words.sandbox.queued, { seconds: String(sandbox.place * secondsPerPlace) }) : sandbox.kind === 'ended' ? words.sandbox.ended : sandbox.kind === 'failed' ? sandbox.text : null
  const busyLine = busy ? words.sandbox.checking : sandbox.kind === 'finishing' ? words.sandbox.finishing : phone ? overlay : null
  const brand = currentBrand()?.productName
  const status = overview.status === 'unpublished_changes' || overview.status === 'same_as_live' || overview.status === 'not_published' ? words.status[overview.status] : null
  const canDiscard = overview.status === 'unpublished_changes'

  return (
    <dialog
      ref={dialogRef}
      className="df-studio"
      aria-label={words.label}
      onCancel={(event) => {
        event.preventDefault()
        if (editing) postEdit(false)
      }}
    >
      <header className="df-studio-bar">
        <button type="button" className="df-button df-studio-back" onClick={onExit}>
          {words.back}
        </button>
        <div className="df-studio-name">
          <strong>{fill(words.title, { template: templateName(templates, overview.template), store: storeName })}</strong>
          {host && <span>{host}</span>}
        </div>
        {status && <span className={`df-studio-pill${canDiscard ? ' df-studio-pill--draft' : ''}`}>{status}</span>}
        <span className="df-studio-gap" />
        {!phone && <PagePicker groups={groups} value={shownPath} onChange={(path) => (setFramePath(path), setShownPath(path))} />}
        {!phone && (
          <>
            <div className="df-studio-devices" role="group" aria-label={words.screen}>
              {studioDevices.map((d) => (
                <button key={d} type="button" aria-pressed={device === d} onClick={() => setDevice(d)}>
                  {words.devices[d]}
                </button>
              ))}
            </div>
            <select className="df-studio-device-select" aria-label={words.screen} value={device} onChange={(e) => setDevice(studioDevices.find((d) => d === e.target.value) ?? 'desktop')}>
              {studioDevices.map((d) => (
                <option key={d} value={d}>
                  {words.devices[d]}
                </option>
              ))}
            </select>
          </>
        )}
        {canDiscard && (
          <button type="button" className="df-sf-link df-sf-link--danger" disabled={locked} onClick={() => setDiscarding(true)}>
            {messages.storefront.overview.discard}
          </button>
        )}
      </header>
      {phone && (
        <div className="df-studio-panes" role="tablist" aria-label={words.label}>
          {(['chat', 'preview'] as const).map((p) => (
            <button key={p} type="button" role="tab" aria-selected={pane === p} onClick={() => setPane(p)}>
              {words.panes[p]}
            </button>
          ))}
        </div>
      )}
      <div className="df-studio-body">
        {(!phone || pane === 'chat') && (
          <StudioChat
            chat={chat}
            hasEarlier={earlier !== null}
            assistant={brand ? fill(words.chat.assistant, { brand }) : words.chat.assistantPlain}
            templateName={nameOf}
            locked={locked}
            canEdit
            busyLine={busyLine}
            error={error}
            api={api}
            onEarlier={more}
            onUndo={undo}
            onSend={send}
          />
        )}
        {(!phone || pane === 'preview') && (
          <div className={`df-studio-preview df-studio-preview--${shownDevice}`}>
            <div className="df-studio-tools">
              {phone && <PagePicker groups={groups} value={shownPath} onChange={(path) => (setFramePath(path), setShownPath(path))} />}
              <span className="df-studio-gap" />
              {editing && !phone && <span className="df-studio-hint">{words.edit.hint}</span>}
              <button type="button" className="df-button df-studio-edit-toggle" aria-pressed={editing} disabled={locked} onClick={() => postEdit(!editing)}>
                {words.edit.button}
              </button>
            </div>
            <div className="df-studio-frame">
              {session && <iframe ref={frameRef} title={words.frameTitle} src={frameAddress(session.frameUrl, framePath)} referrerPolicy="no-referrer" />}
              {overlay && (
                <div className="df-studio-overlay">
                  <div role="status">
                    {sandbox.kind !== 'ended' && sandbox.kind !== 'failed' && <span className="df-studio-spin" aria-hidden="true" />}
                    <span>{overlay}</span>
                    {(sandbox.kind === 'ended' || sandbox.kind === 'failed') && (
                      <button type="button" className="df-button df-button--primary" onClick={() => setOpened((n) => n + 1)}>
                        {words.sandbox.reopen}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      <EditTextDialog
        textKey={textKey}
        page={textPageOf(textKey ?? '', shownPath === '/' ? 'home' : shownPath)}
        pageLabel={pageLabel}
        languages={languages}
        api={api}
        onCancel={() => setTextKey(null)}
        onNotHere={notHere}
        onSaved={() => {
          setTextKey(null)
          setToast(words.edit.saved)
          void after()
        }}
      />
      <ConfirmDialog
        open={discarding}
        danger
        title={messages.storefront.overview.discardTitle}
        target={host ?? storeName}
        consequence={messages.storefront.overview.discardBody}
        confirmLabel={messages.storefront.overview.discardConfirm}
        cancelLabel={messages.storefront.overview.cancel}
        onCancel={() => setDiscarding(false)}
        onConfirm={discard}
      />
      <Toast message={toast} onDone={() => setToast(null)} />
    </dialog>
  )
}

const PagePicker = ({ groups, value, onChange }: { groups: ReturnType<typeof pageGroups>; value: string; onChange: (path: string) => void }) => (
  <label className="df-studio-page">
    <span>{words.page}</span>
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {!groups.some((g) => g.items.some((i) => i.path === value)) && <option value={value}>{value}</option>}
      {groups.map((g) => (
        <optgroup key={g.label} label={g.label}>
          {g.items.map((i) => (
            <option key={i.path} value={i.path}>
              {i.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  </label>
)
