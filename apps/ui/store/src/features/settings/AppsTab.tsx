import { ConfirmDialog, initials, type ConfirmDialogProps } from '@dripfunnel/shared/ui'
import { useState } from 'react'
import { installApp, loadInstallableApp, uninstallApp, type InstallableApp, type InstalledApp } from '../../api/apps'
import { fill, formatList, formatTime, messages } from '../../messages'
import { isHttps } from '../common/https'
import { refusalIn } from '../common/refusal'
import './developers.css'
import { useFreshList } from './useFreshList'

const words = messages.settings.apps
const refusalOf = refusalIn(words.refused)

type Ask = Omit<ConfirmDialogProps, 'open' | 'onCancel' | 'cancelLabel'>

const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

/** The app an install link names: its id, wherever the link carries it (FIRST-RELEASE §15). */
export const appIdOf = (link: string): string | null => (isHttps(link.trim()) ? (uuid.exec(link)?.[0]?.toLowerCase() ?? null) : null)

const scopeWords = (scopes: readonly string[]) => scopes.map((s) => (words.scopes as Record<string, string>)[s] ?? s)

/** What the consent screen says it won't do: the reads it wasn't given, and what no app may. */
const wontOf = (app: InstallableApp) => [...Object.keys(words.scopes).filter((s) => !app.scopes.includes(s)).map((s) => (words.scopes as Record<string, string>)[s] ?? s), ...words.never]

const hostOf = (url: string): string => (isHttps(url) ? new URL(url).host : '')

export interface AppsTabProps {
  initial: readonly InstalledApp[]
  read: () => Promise<InstalledApp[]>
  canEdit: boolean
  onToast: (text: string) => void
}

/** Apps (SetDev "apps", FIRST-RELEASE §15): add one from its install link after consent, open it on its own site, remove it. */
export const AppsTab = ({ initial, read, canEdit, onToast }: AppsTabProps) => {
  const { list: apps, stale, refresh } = useFreshList(initial, read)
  const [adding, setAdding] = useState<{ error: string | null } | null>(null)
  const [consent, setConsent] = useState<{ app: InstallableApp; error: string | null } | null>(null)
  const [ask, setAsk] = useState<Ask | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const ro = !canEdit || busy

  const find = async (link: string) => {
    const id = appIdOf(link)
    if (!id) return setAdding({ error: isHttps(link.trim()) ? words.noApp : words.notHttps })
    setAdding({ error: null })
    setBusy(true)
    try {
      const app = await loadInstallableApp(id)
      if (!app) return setAdding({ error: words.refused.NOT_FOUND })
      setAdding(null)
      setConsent({ app, error: null })
    } catch (error) {
      setAdding({ error: refusalOf(error) })
    } finally {
      setBusy(false)
    }
  }

  const install = async (app: InstallableApp) => {
    setConsent({ app, error: null })
    setBusy(true)
    try {
      await installApp(app.id, app.scopes)
      setConsent(null)
      onToast(fill(words.installed, { name: app.name }))
      void refresh()
    } catch (error) {
      // The app asked for other access since the screen was read: show what it asks now before another try.
      const fresh = await loadInstallableApp(app.id).catch(() => null)
      setConsent({ app: fresh ?? app, error: refusalOf(error) })
    } finally {
      setBusy(false)
    }
  }

  const askRemove = (app: InstalledApp) =>
    setAsk({
      title: fill(words.removeTitle, { name: app.name }),
      target: app.name,
      consequence: words.removeBody,
      confirmLabel: words.removeGo,
      danger: true,
      onConfirm: () =>
        void (async () => {
          setBusy(true)
          setNote(null)
          try {
            await uninstallApp(app.id)
            onToast(fill(words.removed, { name: app.name }))
            void refresh()
          } catch (error) {
            setNote(refusalOf(error))
          } finally {
            setBusy(false)
          }
        })(),
    })

  const stateLine = (app: InstalledApp) => {
    if (app.suspended) return <p className="df-set-warning df-dev-warn">{words.suspended}</p>
    if (app.connection === 'failed') return <p className="df-set-warning df-dev-warn">{words.failed}</p>
    if (app.connection === 'waiting') return <p className="df-set-help">{words.waiting}</p>
    return null
  }

  return (
    <div className="df-set-store df-dev">
      <div className="df-dev-head">
        <div>
          <h2 className="df-set-title">{words.title}</h2>
          <p className="df-set-sub">{words.sub}</p>
        </div>
        <button
          type="button"
          className="df-button df-button--primary"
          disabled={ro || consent !== null}
          onClick={() => {
            setNote(null)
            setAdding({ error: null })
          }}
        >
          {words.add}
        </button>
      </div>
      <p className="df-set-note">{words.about}</p>
      {consent && (
        <section className="df-set-card df-dev-new" aria-label={fill(words.installTitle, { name: consent.app.name })}>
          <div className="df-app-who">
            <span className="df-app-mark" aria-hidden="true">
              {initials(consent.app.name).slice(0, 2)}
            </span>
            <span className="df-dev-cell">
              <h3 className="df-dev-h3">{fill(words.installTitle, { name: consent.app.name })}</h3>
              <span className="df-dev-muted">{[fill(words.by, { developer: consent.app.developer }), hostOf(consent.app.siteUrl)].filter(Boolean).join(' · ')}</span>
            </span>
          </div>
          {consent.error && (
            <p className="df-set-failure" role="alert">
              {consent.error}
            </p>
          )}
          <strong className="df-set-label">{words.can}</strong>
          <ul className="df-app-list">
            {scopeWords(consent.app.scopes).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <strong className="df-set-label">{words.cannot}</strong>
          <ul className="df-app-list">
            {wontOf(consent.app).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <span className="df-set-help">{words.wholeStore}</span>
          <div className="df-dev-buttons">
            <button type="button" className="df-button df-button--primary" disabled={ro} onClick={() => void install(consent.app)}>
              {words.install}
            </button>
            <button type="button" className="df-button" disabled={busy} onClick={() => setConsent(null)}>
              {words.cancel}
            </button>
          </div>
        </section>
      )}
      {note && (
        <p className="df-set-failure" role="alert">
          {note}
        </p>
      )}
      {stale && (
        <p className="df-set-warning" role="status">
          {words.stale}
        </p>
      )}
      {apps.length === 0 && !consent ? (
        <p className="df-dev-empty">{words.empty}</p>
      ) : (
        <ul className="df-app-rows" aria-label={words.listLabel}>
          {apps.map((app) => {
            const time = formatTime(app.installedAt)
            return (
              <li key={app.id} className="df-set-card df-app-row">
                <span className="df-app-mark" aria-hidden="true">
                  {initials(app.name).slice(0, 2)}
                </span>
                <span className="df-dev-cell df-app-text">
                  <strong className="df-dev-h3">{app.name}</strong>
                  <span className="df-dev-muted">{app.installedByName ? fill(words.meta, { developer: app.developer, time, name: app.installedByName }) : fill(words.metaNoName, { developer: app.developer, time })}</span>
                  <span>{fill(words.access, { scopes: formatList(scopeWords(app.scopes)) })}</span>
                  {app.lastUsedAt && <span className="df-dev-muted">{fill(words.lastUsed, { time: formatTime(app.lastUsedAt) })}</span>}
                  {stateLine(app)}
                </span>
                <span className="df-dev-buttons">
                  {isHttps(app.siteUrl) && (
                    <a className="df-button" href={app.siteUrl} target="_blank" rel="noopener noreferrer" aria-label={fill(words.openName, { name: app.name })}>
                      {words.open} ↗
                    </a>
                  )}
                  <button type="button" className="df-button df-set-delete" disabled={ro} aria-label={fill(words.removeName, { name: app.name })} onClick={() => askRemove(app)}>
                    {words.remove}
                  </button>
                </span>
              </li>
            )
          })}
        </ul>
      )}
      {adding && (
        <ConfirmDialog
          open
          title={words.add}
          target=""
          consequence={words.addBody}
          confirmLabel={words.next}
          cancelLabel={words.cancel}
          input={{ label: words.link, type: 'text', initial: '', placeholder: words.linkPlaceholder, error: (v) => (v.trim() === '' ? words.notHttps : null) }}
          error={adding.error}
          onCancel={() => setAdding(null)}
          onConfirm={(_, value) => void find(value ?? '')}
        />
      )}
      {ask && (
        <ConfirmDialog
          key={`${ask.title}|${ask.confirmLabel}`}
          {...ask}
          open
          cancelLabel={words.cancel}
          onCancel={() => setAsk(null)}
          onConfirm={(...args) => {
            setAsk(null)
            ask.onConfirm(...args)
          }}
        />
      )}
    </div>
  )
}
