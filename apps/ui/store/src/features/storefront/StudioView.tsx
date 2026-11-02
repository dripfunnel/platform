import { isApiError } from '@dripfunnel/shared/graphql'
import { ConfirmDialog, Toast, usePhone } from '@dripfunnel/shared/ui'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { StorefrontMeters, StorefrontOverview, StorefrontTemplate } from '../../api/storefront'
import { studioDevices, type DesignMessage, type PublishRun, type StudioDevice, type StudioPages } from '../../api/studio'
import { currentBrand } from '../../brand/current'
import { fill, formatCount, messages } from '../../messages'
import { isHttps } from '@dripfunnel/shared/format'
import { refusalIn } from '../common/refusal'
import { tabKeyHandler } from '../common/tabKeys'
import { discardRefusal, templateName } from './overviewView'
import { useChatWidth } from './useChatWidth'
import { EditTextDialog } from './EditTextDialog'
import { StudioChat, type ChatRequest } from './StudioChat'
import { askRefusal, editModeMessage, frameAddress, frameMessage, frameOriginOf, openingPollMs, pageGroups, publishProgress, failedWords, publishRefusal, refusedText, renewEveryMs, rolledBackText, secondsPerPlace, textPageOf } from './studioRules'
import type { StorefrontApi } from './storefrontApi'
import { usePublishRun } from './usePublishRun'
import './studio.css'

const words = messages.storefront.studio
const previewRefusal = refusalIn(words.preview.refused)

const studioPanes = ['chat', 'preview'] as const
type StudioPane = (typeof studioPanes)[number]
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
  usage: StorefrontMeters['usage'] | null
  /** The publish being followed, kept in the address so a reload keeps following it. */
  run: string | null
  onRun: (id: string | null) => void
}

const sandboxOf = (state: string, place: number | null): Sandbox =>
  state === 'ready' ? { kind: 'ready' } : state === 'queued' ? { kind: 'queued', place: place ?? 1 } : state === 'busy' ? { kind: 'finishing' } : state === 'unavailable' ? { kind: 'failed', text: words.sandbox.unavailable } : { kind: 'opening' }

/** The full-screen AI studio (PortalStorefront › studio; FIRST-RELEASE §14; storefront AI-STUDIO §1, §3, §8). */
export const StudioView = ({ overview, templates, storeName, host, api, onExit, onOverview, usage, run, onRun }: StudioViewProps) => {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const phone = usePhone()
  const { bodyRef, ...chatWidth } = useChatWidth()
  const [session, setSession] = useState<Session | null>(null)
  const [models, setModels] = useState<readonly string[]>([])
  const [sandbox, setSandbox] = useState<Sandbox>({ kind: 'opening' })
  const [opened, setOpened] = useState(0)
  const [chat, setChat] = useState<DesignMessage[]>([])
  const [earlier, setEarlier] = useState<string | null>(null)
  // A later read that fails keeps the conversation already shown.
  const [chatRead, setChatRead] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pages, setPages] = useState<StudioPages>({ product: null, content: [], custom: [] })
  const [languages, setLanguages] = useState<string[]>([])
  const [device, setDevice] = useState<StudioDevice>('desktop')
  const [pane, setPane] = useState<StudioPane>('chat')
  const panesId = useId()
  // Each pick is a new visit, so the frame goes there even when its address already names that page (it may have moved itself).
  const [visit, setVisit] = useState({ path: '/', count: 0 })
  const [shownPath, setShownPath] = useState('/')
  const [editing, setEditing] = useState(false)
  const [textKey, setTextKey] = useState<string | null>(null)
  const [discarding, setDiscarding] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [published, setPublished] = useState<PublishRun | null>(null)
  const [publishing, setPublishing] = useState<{ before: string | null } | null>(null)
  const [previewMenu, setPreviewMenu] = useState(false)
  const [ending, setEnding] = useState(false)
  const moreRef = useRef<HTMLButtonElement>(null)
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
        setChatRead('ready')
      },
      () => ask === chatAsk.current && setChatRead((was) => (was === 'ready' ? was : 'failed')),
    )
  }, [api])

  // Opening: a new session, read again while the sandbox starts or queues; Reopen opens another.
  useEffect(() => {
    let current = true
    let timer: ReturnType<typeof setTimeout> | undefined
    setSandbox({ kind: 'opening' })
    setEditing(false)
    const read = (id: string | null) =>
      api.loadStudioSession(id).then(
        (s) => {
          if (!current) return
          const origin = frameOriginOf(s.frameUrl, window.location.origin)
          if (!origin) return setSandbox({ kind: 'failed', text: words.sandbox.unavailable })
          setModels(s.models)
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

  const publishEnded = useCallback(
    (answer: PublishRun | null) => {
      if (!answer) return onRun(null)
      setPublished(answer)
      if (answer.step === 'live') {
        setToast(fill(words.publish.live, { number: String(answer.version ?? '') }))
        onRun(null)
      }
      void loadChat()
      void api.loadOverview().then(onOverview, () => undefined)
    },
    [api, onRun, loadChat, onOverview],
  )
  const publishReadFailed = useCallback((e: unknown) => {
    if (isApiError(e, 'SESSION_ENDED')) setSandbox({ kind: 'ended' })
  }, [])
  const { lost, checkAgain } = usePublishRun(api, run, { onProgress: setPublished, onEnd: publishEnded, onReadError: publishReadFailed, restart: opened })

  const publish = async (before: string | null) => {
    setPublishing(null)
    if (locked) return
    setError(null)
    setPublished(null)
    try {
      onRun(before ? await api.publishBefore(before) : await api.publishDesign())
    } catch (e) {
      setError(publishRefusal(e))
    }
  }

  // The window opens on the click, before the link is signed, so no pop-up blocker stops it; it carries nothing back.
  const openPreview = () => {
    const tab = window.open('', '_blank')
    if (tab) tab.opener = null
    api.previewLink().then(
      (link) => {
        if (tab && isHttps(link)) tab.location.href = link
        else tab?.close()
      },
      (e: unknown) => {
        tab?.close()
        setError(previewRefusal(e))
      },
    )
  }
  const endLinks = () => {
    setEnding(false)
    api.endPreviewLinks().then(
      () => setToast(words.preview.ended),
      (e: unknown) => setError(previewRefusal(e)),
    )
  }

  // A new frame starts in its normal mode, so Edit text turns off with every new frame (a page picked, the studio reopened).
  const pick = (path: string) => {
    setEditing(false)
    setVisit((was) => ({ path, count: was.count + 1 }))
    setShownPath(path)
  }

  const postEdit = (on: boolean) => {
    setEditing(on)
    if (session) frameRef.current?.contentWindow?.postMessage(editModeMessage(on), session.origin)
  }

  const progress = run !== null && (published === null || published.id !== run) ? publishProgress('queued') : published && published.id === run ? publishProgress(published.step) : null
  const locked = sandbox.kind !== 'ready' || busy || progress !== null
  const shownDevice = phone ? 'phone' : device
  const editButton = (
    <button type="button" className="df-button df-studio-edit-toggle" aria-pressed={editing} disabled={locked} onClick={() => postEdit(!editing)}>
      {words.edit.button}
    </button>
  )
  // Reads after a change never throw: the chat says when it couldn't load, and the design keeps its last answer.
  const after = async () => {
    await loadChat()
    await api.loadOverview().then(onOverview, () => undefined)
  }
  const perform = async (work: () => Promise<unknown>, refusal: (e: unknown) => string): Promise<boolean> => {
    if (locked) return false
    setBusy(true)
    setError(null)
    try {
      await work()
    } catch (e) {
      if (isApiError(e, 'SESSION_ENDED')) setSandbox({ kind: 'ended' })
      setError(refusal(e))
      setBusy(false)
      return false
    }
    // A change after a refused or rolled-back publish moves the draft on, so that publish's notice and offer go.
    if (run) onRun(null)
    setPublished(null)
    await after()
    setBusy(false)
    return true
  }
  // An accepted change reaches the frame by its own hot reload, so the frame's address never changes here (AI-STUDIO §4 step 5).
  const send = (request: ChatRequest) => perform(() => api.askDesign({ ...request, page: shownPath, device: shownDevice }), askRefusal)
  const stop = () => void api.cancelDesign().catch(() => undefined)
  const undo = (message: DesignMessage) => void perform(() => api.undoDesignChange(message.id), askRefusal)
  const discard = () => {
    setDiscarding(false)
    void perform(() => api.discardDraft(), discardRefusal)
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
  const hasDraft = canDiscard || overview.status === 'not_published'
  const next = (overview.live?.number ?? 0) + 1
  const ended = published && published.id === run ? published : null
  const suggestions = published?.step === 'live' ? failedWords(published) : []
  const culprit = ended?.bisectMessageId ? chat.find((m) => m.id === ended.bisectMessageId) : undefined
  const closeMenu = () => {
    setPreviewMenu(false)
    moreRef.current?.focus()
  }
  const previewButtons = overview.draft?.previewReady ? (
    <div
      className="df-studio-preview-buttons"
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget instanceof Node ? e.relatedTarget : null) && setPreviewMenu(false)}
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || !previewMenu) return
        e.preventDefault()
        closeMenu()
      }}
    >
      <button type="button" className="df-button" onClick={openPreview}>
        {words.preview.open}
      </button>
      <button ref={moreRef} type="button" className="df-button" aria-label={words.preview.more} aria-expanded={previewMenu} aria-controls={`${panesId}-preview-menu`} onClick={() => setPreviewMenu((o) => !o)}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {previewMenu && (
        <div id={`${panesId}-preview-menu`} className="df-studio-menu">
          <button
            type="button"
            ref={(el) => el?.focus()}
            onClick={() => {
              closeMenu()
              setEnding(true)
            }}
          >
            {words.preview.end}
          </button>
        </div>
      )}
    </div>
  ) : null
  // In the chat's list, so each notice is a list item holding the alert (WCAG 4.1.2).
  const notice = lost ? (
    <li>
      <div className="df-studio-refused" role="alert">
        <span>{words.publish.lost}</span>
        <button type="button" className="df-button" onClick={checkAgain}>
          {words.publish.checkAgain}
        </button>
      </div>
    </li>
  ) : ended?.step === 'failed' ? (
    <li>
      <div className="df-studio-refused" role="alert">
        <strong>{fill(words.publish.refusedTitle, { number: String(ended.version ?? next) })}</strong>
        <span>{refusedText(ended)}</span>
        {culprit && <span className="df-sf-lede">{fill(words.publish.culprit, { text: culprit.text })}</span>}
        {culprit && (
          <button type="button" className="df-button" disabled={locked} onClick={() => setPublishing({ before: culprit.id })}>
            {words.publish.before}
          </button>
        )}
      </div>
    </li>
  ) : published?.step === 'live' && suggestions.length > 0 ? (
    <li>
      <div className="df-studio-suggestions" role="status">
        <strong>{fill(words.publish.liveWithSuggestions, { number: String(published.version ?? next - 1) })}</strong>
        <span>{words.publish.suggestionsLede}</span>
        <ul>
          {suggestions.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
      </div>
    </li>
  ) : ended?.step === 'rolled_back' ? (
    <li>
      <div className="df-studio-refused" role="alert">
        <span>{rolledBackText(ended, Math.max(1, (ended.version ?? next) - 1))}</span>
      </div>
    </li>
  ) : null
  const paneProps = (p: StudioPane) => (phone ? { id: `${panesId}-${p}-panel`, role: 'tabpanel', 'aria-labelledby': `${panesId}-${p}`, hidden: pane !== p } : {})

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
        {!phone && <PagePicker groups={groups} value={shownPath} onChange={pick} />}
        {!phone && editButton}
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
        {progress ? (
          <div className="df-studio-progress" role="status">
            <span className="df-studio-progress-bar" aria-hidden="true">
              <span style={{ width: `${progress.percent}%` }} />
            </span>
            <span>{progress.text}</span>
          </div>
        ) : (
          <>
            {!phone && previewButtons}
            {canDiscard && (
              <button type="button" className="df-sf-link" disabled={locked} onClick={() => setDiscarding(true)}>
                {messages.storefront.overview.discard}
              </button>
            )}
            <button type="button" className="df-button df-button--primary df-studio-publish" disabled={locked || !hasDraft} onClick={() => setPublishing({ before: null })}>
              {overview.live ? words.publish.button : words.publish.firstButton}
            </button>
          </>
        )}
      </header>
      {phone && (
        <div className="df-studio-panes" role="tablist" aria-label={words.label} onKeyDown={tabKeyHandler(studioPanes, pane, setPane, (p) => document.getElementById(`${panesId}-${p}`)?.focus())}>
          {studioPanes.map((p) => (
            <button key={p} id={`${panesId}-${p}`} type="button" role="tab" aria-selected={pane === p} aria-controls={`${panesId}-${p}-panel`} tabIndex={pane === p ? 0 : -1} onClick={() => setPane(p)}>
              {words.panes[p]}
            </button>
          ))}
        </div>
      )}
      {/* On a phone both panes stay mounted, so the frame keeps its page while the chat shows. */}
      <div className={chatWidth.dragging ? 'df-studio-body df-studio-body--dragging' : 'df-studio-body'} ref={bodyRef} style={phone ? undefined : ({ '--df-studio-chat-w': `${chatWidth.width}px` } as React.CSSProperties)}>
        <div className="df-studio-pane" {...paneProps('chat')}>
          <StudioChat
            chat={chat}
            chatRead={chatRead}
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
            onStop={stop}
            notice={notice}
            models={models}
            aiLine={!usage ? null : usage.ownKey ? words.usageOwn : usage.aiPromptsAllowed === null ? null : fill(words.usageLine, { left: formatCount(Math.max(0, usage.aiPromptsAllowed - usage.aiPromptsUsed)) })}
          />
        </div>
        {!phone && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={words.resize}
            aria-valuemin={chatWidth.min}
            aria-valuemax={chatWidth.max}
            aria-valuenow={chatWidth.width}
            tabIndex={0}
            className="df-studio-resizer"
            {...chatWidth.handle}
          />
        )}
        <div className="df-studio-pane df-studio-pane--preview" {...paneProps('preview')}>
          <div className={`df-studio-preview df-studio-preview--${shownDevice}`}>
            {(phone || editing) && <div className="df-studio-toolbar">
              {phone && <PagePicker groups={groups} value={shownPath} onChange={pick} />}
              {phone && previewButtons}
              <span className="df-studio-gap" />
              {editing && !phone && <span className="df-studio-hint">{words.edit.hint}</span>}
              {phone && editButton}
            </div>}
            <div className="df-studio-frame">
              {session && <iframe key={visit.count} ref={frameRef} title={words.frameTitle} src={frameAddress(session.frameUrl, visit.path)} referrerPolicy="no-referrer" />}
              {overlay && (
                <div className="df-studio-overlay">
                  <div role="status">
                    <span className="df-studio-overlay-line">
                      {sandbox.kind !== 'ended' && sandbox.kind !== 'failed' && <span className="df-studio-spin" aria-hidden="true" />}
                      <span>{overlay}</span>
                    </span>
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
        </div>
      </div>
      <EditTextDialog
        textKey={textKey}
        page={textPageOf(textKey ?? '', shownPath === '/' ? 'home' : shownPath)}
        pageLabel={pageLabel}
        languages={languages}
        api={api}
        onCancel={() => setTextKey(null)}
        onNotHere={notHere}
        onPartlySaved={() => void after()}
        onSaved={() => {
          setTextKey(null)
          setToast(words.edit.saved)
          void after()
        }}
      />
      <ConfirmDialog
        open={ending}
        danger
        title={words.preview.endTitle}
        target={host ?? storeName}
        consequence={words.preview.endBody}
        confirmLabel={words.preview.endConfirm}
        cancelLabel={words.preview.cancel}
        onCancel={() => setEnding(false)}
        onConfirm={endLinks}
      />
      <ConfirmDialog
        open={publishing !== null}
        title={fill(words.publish.title, { number: String(next) })}
        target={host ?? storeName}
        consequence={overview.live ? `${fill(words.publish.body, { host: host ?? storeName })} ${fill(words.publish.back, { number: String(overview.live.number) })}` : fill(words.publish.body, { host: host ?? storeName })}
        confirmLabel={words.publish.confirm}
        cancelLabel={words.publish.cancel}
        onCancel={() => setPublishing(null)}
        onConfirm={() => void publish(publishing?.before ?? null)}
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
