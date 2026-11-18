// States (?state=): loading, empty, error, readonly; see messagingHarness.ts.
import { routeProviders, smsProviders, smsRoutes, servesCodes, type SmsProvider, type SmsRoute, type WhatsAppRejection } from '@dripfunnel/shared/messaging'
import { ErrorState, ListHeader, LoadingState, ReadOnlyNotice, StatusPill, type StatusIconName, type StatusTone } from '@dripfunnel/shared/ui'
import { useId, type ReactNode } from 'react'
import type { Messaging as MessagingData, PlatformSmsAccount, PlatformWhatsApp } from '../../api/messaging'
import { fill, formatTime, messages } from '../../messages'
import type { MessagingScreenState } from './messagingHarness'
import '@dripfunnel/shared/ui/list.css'
import '@dripfunnel/shared/ui/detail.css'
import '../common/records.css'
import './messaging.css'

const words = messages.messaging
const sms = words.sms
const wa = words.whatsapp
const look: Record<PlatformSmsAccount['status'], { tone: StatusTone; icon: StatusIconName }> = {
  ok: { tone: 'success', icon: 'ok' },
  untested: { tone: 'neutral', icon: 'clock' },
  rejected: { tone: 'danger', icon: 'cross' },
}

export type MessagingAction = { kind: 'smsSave' | 'smsRemove'; provider: SmsProvider } | { kind: 'smsRoute'; route: SmsRoute } | { kind: 'waSave' | 'waOn' | 'waOff' | 'waRemove' }
export type TestTarget = SmsProvider | 'whatsapp'

export interface MessagingProps {
  messaging: MessagingData
  forced: MessagingScreenState | null
  canManage: boolean
  testing: TestTarget | null
  // What Meta refused at the last Test of DripFunnel's WhatsApp in this visit.
  rejection: WhatsAppRejection | null
  onAction: (action: MessagingAction) => void
  onTest: (target: TestTarget) => void
  onReload: () => void
}

export const providerName = (provider: SmsProvider) => sms.providers[provider]
const tested = (at: string | null) => (at ? fill(words.lastTested, { when: formatTime(at) }) : words.neverTested)

export const emptyMessaging: MessagingData = {
  sms: { routes: smsRoutes.map((route) => ({ route, provider: null, serving: null })), accounts: [] },
  whatsapp: { enabled: false, account: null },
}

/** What Meta refused, by name: the token, the number, the business account, or which template in which language. */
export const problemText = (rejection: WhatsAppRejection, whatsapp: PlatformWhatsApp): string => {
  if (rejection.problem !== 'template') return wa.problems[rejection.problem]
  const name = whatsapp.account?.templates.find((t) => t.message === rejection.template)?.name ?? ''
  return fill(wa.problems.template, { name, language: whatsapp.account?.language ?? '', message: wa.messages[rejection.template] })
}

const Header = () => <ListHeader level={words.level} title={words.title} sub={words.sub} />

export const MessagingLoading = () => (
  <div className="df-page df-list">
    <Header />
    <LoadingState label={words.loading} rows={6} />
  </div>
)

export const MessagingError = ({ onRetry }: { onRetry: () => void }) => (
  <div className="df-page df-list">
    <Header />
    <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry }} />
  </div>
)

const Button = ({ label, short, primary = false, disabled, onClick }: { label: string; short?: string; primary?: boolean; disabled: boolean; onClick: () => void }) => (
  <button type="button" className={primary ? 'df-button df-button--primary' : 'df-button'} aria-label={short ? label : undefined} disabled={disabled} onClick={onClick}>
    {short ?? label}
  </button>
)

const SmsPanel = ({ data, manage, testing, onAction, onTest }: { data: MessagingData['sms']; manage: boolean } & Pick<MessagingProps, 'testing' | 'onAction' | 'onTest'>) => {
  const accountOf = (provider: SmsProvider) => data.accounts.find((a) => a.provider === provider) ?? null
  const busy = testing !== null
  return (
    <section className="df-panel df-panel--wide df-messaging-panel" aria-labelledby="messaging-sms" aria-busy={busy}>
      <h2 id="messaging-sms">{sms.title}</h2>
      <p className="df-muted df-messaging-note">{words.secretNote}</p>
      <h3>{sms.routesTitle}</h3>
      <ul className="df-checklist">
        {smsRoutes.map((route) => {
          const row = data.routes.find((r) => r.route === route)
          const serving = row?.serving ?? null
          return (
            <li key={route}>
              <div className="df-messaging-text">
                <p>
                  <strong>{sms.routes[route]}</strong>
                </p>
                <p>{serving ? fill(sms.sentBy, { provider: providerName(serving) }) : sms.unsent}</p>
                <p className="df-muted">{row?.provider ? fill(sms.pick, { provider: providerName(row.provider) }) : sms.pickAuto}</p>
              </div>
              {manage && routeProviders[route].some((p) => accountOf(p)) && (
                <Button label={fill(sms.change, { route: sms.routes[route] })} short={sms.short.change} disabled={busy} onClick={() => onAction({ kind: 'smsRoute', route })} />
              )}
            </li>
          )
        })}
      </ul>
      <h3>{sms.accountsTitle}</h3>
      <ul className="df-checklist">
        {smsProviders.map((provider) => {
          const account = accountOf(provider)
          const name = providerName(provider)
          return (
            <li key={provider} aria-busy={testing === provider}>
              <div className="df-messaging-text">
                <p>
                  <strong>{name}</strong>
                </p>
                <p className="df-muted">{sms.serves[provider]}</p>
                {account && (
                  <>
                    <p>
                      {sms.secretLabels[provider]} <code>{account.hint}</code>
                    </p>
                    {account.templatesComplete !== null && <p className="df-muted">{account.templatesComplete ? sms.india.complete : sms.india.incomplete}</p>}
                    <p className="df-muted">{tested(account.lastTestedAt)}</p>
                    {account.status === 'rejected' && <p className="df-muted">{fill(sms.rejectedNote, { provider: name })}</p>}
                  </>
                )}
              </div>
              <div className="df-messaging-side">
                {account ? <StatusPill {...look[account.status]} label={words.statuses[account.status]} /> : <span className="df-muted">{sms.notSetUp}</span>}
                {manage && (
                  <div className="df-messaging-actions">
                    <Button label={fill(account ? sms.replace : sms.setUp, { provider: name })} short={account ? sms.short.replace : sms.short.setUp} primary={!account} disabled={busy} onClick={() => onAction({ kind: 'smsSave', provider })} />
                    {account && <Button label={fill(sms.test, { provider: name })} short={testing === provider ? words.testing : sms.short.test} disabled={busy} onClick={() => onTest(provider)} />}
                    {account && <Button label={fill(sms.remove, { provider: name })} short={sms.short.remove} disabled={busy} onClick={() => onAction({ kind: 'smsRemove', provider })} />}
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

const Fact = ({ term, children }: { term: string; children: ReactNode }) => (
  <>
    <dt>{term}</dt>
    <dd>{children}</dd>
  </>
)

const WhatsAppPanel = ({ data, manage, testing, rejection, onAction, onTest }: { data: PlatformWhatsApp; manage: boolean } & Pick<MessagingProps, 'testing' | 'rejection' | 'onAction' | 'onTest'>) => {
  const noteId = useId()
  const { enabled, account } = data
  const busy = testing !== null
  const canTurnOn = account !== null && servesCodes(account)
  // Why On isn't offered yet, also what the disabled Turn on points to.
  const why = account?.status === 'rejected' ? wa.rejectedNote : account && !enabled && !canTurnOn ? wa.needsCodeTemplate : null
  return (
    <section className="df-panel df-panel--wide" aria-labelledby="messaging-whatsapp" aria-busy={testing === 'whatsapp'}>
      <div className="df-panel-head">
        <h2 id="messaging-whatsapp">{wa.title}</h2>
        <StatusPill tone={enabled ? 'success' : 'neutral'} icon={enabled ? 'ok' : 'ban'} label={enabled ? wa.on : wa.off} />
      </div>
      <p className="df-muted df-messaging-note">{wa.note}</p>
      {account ? (
        <dl className="df-facts">
          <Fact term={wa.businessAccountLabel}>
            <code>{account.businessAccountId}</code>
          </Fact>
          <Fact term={wa.phoneNumberLabel}>
            <code>{account.phoneNumberId}</code>
          </Fact>
          <Fact term={wa.tokenLabel}>
            <code>{account.hint}</code>
          </Fact>
          <Fact term={wa.languageLabel}>
            <code>{account.language}</code>
          </Fact>
          <Fact term={wa.statusLabel}>
            <span className="df-messaging-status">
              <StatusPill {...look[account.status]} label={words.statuses[account.status]} />
              <span className="df-muted">{tested(account.lastTestedAt)}</span>
            </span>
          </Fact>
          {account.templates.map((t) => (
            <Fact key={t.message} term={wa.messages[t.message]}>
              {t.name ? <code>{t.name}</code> : <span className="df-muted">{words.notUsed}</span>}
            </Fact>
          ))}
        </dl>
      ) : (
        <p className="df-muted">{wa.none}</p>
      )}
      {rejection && account?.status === 'rejected' && <p role="alert">{problemText(rejection, data)}</p>}
      {why && (
        <p id={noteId} className="df-muted">
          {why}
        </p>
      )}
      {manage && (
        <div className="df-messaging-actions">
          <Button label={account ? wa.replace : wa.setUp} primary={!account} disabled={busy} onClick={() => onAction({ kind: 'waSave' })} />
          {account && <Button label={testing === 'whatsapp' ? words.testing : wa.test} disabled={busy} onClick={() => onTest('whatsapp')} />}
          {account &&
            (enabled ? (
              <Button label={wa.turnOff} disabled={busy} onClick={() => onAction({ kind: 'waOff' })} />
            ) : (
              <button type="button" className="df-button df-button--primary" disabled={busy || !canTurnOn} aria-describedby={why ? noteId : undefined} onClick={() => onAction({ kind: 'waOn' })}>
                {wa.turnOn}
              </button>
            ))}
          {account && <Button label={wa.remove} disabled={busy} onClick={() => onAction({ kind: 'waRemove' })} />}
        </div>
      )}
    </section>
  )
}

export const Messaging = ({ messaging, forced, canManage, testing, rejection, onAction, onTest, onReload }: MessagingProps) => {
  if (forced === 'loading') return <MessagingLoading />
  if (forced === 'error') return <MessagingError onRetry={onReload} />
  const data = forced === 'empty' ? emptyMessaging : messaging
  const manage = canManage && forced !== 'readonly'
  return (
    <div className="df-page df-list">
      <Header />
      {!manage && <ReadOnlyNotice title={words.readOnly.title} body={words.readOnly.body} />}
      <div className="df-panels">
        <SmsPanel data={data.sms} manage={manage} testing={testing} onAction={onAction} onTest={onTest} />
        <WhatsAppPanel data={data.whatsapp} manage={manage} testing={testing} rejection={rejection} onAction={onAction} onTest={onTest} />
      </div>
    </div>
  )
}
