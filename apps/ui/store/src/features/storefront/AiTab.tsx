import { isApiError } from '@dripfunnel/shared/graphql'
import { ConfirmDialog, ErrorState, LoadingState, type ConfirmDialogProps } from '@dripfunnel/shared/ui'
import { useCallback, useEffect, useId, useState } from 'react'
import { aiProviders, beginStoreAiOauth, connectStoreAiAccount, finishStoreAiOauth, loadPlanRuns, loadStoreAiAccount, loadStoreAiSignIn, removeStoreAiAccount, setStoreAiSwitch, testStoreAiAccount, type AiProvider, type PlanRuns, type StoreAiAccount } from '../../api/aiAccount'
import { fill, formatCount, formatTime, messages } from '../../messages'
import { isHttps } from '@dripfunnel/shared/format'
import { refusalIn } from '../common/refusal'
import '../settings/developers.css'
import '../settings/settings.css'

const words = messages.storefront.ai
const refusalOf = refusalIn(words.refused)

export interface AiReads {
  account: () => Promise<StoreAiAccount | null>
  signIn: () => Promise<Record<AiProvider, boolean>>
  /** Null when the plan's runs couldn't be read: the card is left out. */
  runs: () => Promise<PlanRuns | null>
}

export const aiReads: AiReads = { account: loadStoreAiAccount, signIn: loadStoreAiSignIn, runs: () => loadPlanRuns().catch(() => null) }

export const sampleAiReads: AiReads = {
  account: async () => ({ provider: 'anthropic', keyPrefix: 'sk-ant-api03-Qx', status: 'ok', lastTestedAt: '2026-10-11T10:44:00Z', useWhenPlanUsed: false, connectedBy: 'Farhan Ali', authType: 'api_key', accountLabel: null }),
  signIn: async () => ({ anthropic: false, openai: true }),
  runs: async () => ({ used: 38, allowed: 50 }),
}

type Loaded = { account: StoreAiAccount | null; signIn: Record<AiProvider, boolean>; runs: PlanRuns | null }

export interface AiTabProps {
  reads: AiReads
  canEdit: boolean
  onToast: (text: string) => void
}

/** AI (SetAi, card #950): the store's own AI account, by ChatGPT sign-in or one sealed key, and the switch to use it once the plan's runs are used up. */
export const AiTab = ({ reads, canEdit, onToast }: AiTabProps) => {
  const [loaded, setLoaded] = useState<Loaded | null | 'error'>(null)
  const load = useCallback(() => {
    setLoaded(null)
    void Promise.all([reads.account(), reads.signIn().catch(() => ({ anthropic: false, openai: false })), reads.runs()]).then(
      ([account, signIn, runs]) => setLoaded({ account, signIn, runs }),
      () => setLoaded('error'),
    )
  }, [reads])
  useEffect(load, [load])
  if (loaded === 'error') return <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry: load }} />
  if (!loaded) return <LoadingState label={words.loading} />
  return <AiAccount initial={loaded.account} signIn={loaded.signIn} runs={loaded.runs} read={reads.account} canEdit={canEdit} onToast={onToast} />
}

interface AiAccountProps extends Omit<AiTabProps, 'reads'> {
  initial: StoreAiAccount | null
  signIn: Record<AiProvider, boolean>
  runs: PlanRuns | null
  read: () => Promise<StoreAiAccount | null>
}

const AiAccount = ({ initial, signIn, runs, read, canEdit, onToast }: AiAccountProps) => {
  const id = useId()
  const [account, setAccount] = useState(initial)
  const [expired, setExpired] = useState(false)
  const [pending, setPending] = useState<AiProvider | null>(null)
  const [pasted, setPasted] = useState('')
  const [provider, setProvider] = useState<AiProvider>('anthropic')
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState<'connect' | 'test' | 'other' | 'signin' | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [ask, setAsk] = useState<Omit<ConfirmDialogProps, 'open' | 'onCancel' | 'cancelLabel'> | null>(null)
  const ro = !canEdit || busy !== null
  // Connecting an account (sign-in or key) is allowed while the store is view-only; the tab is already the Owner's alone.
  const signInBusy = busy !== null
  const oauth = account?.authType === 'oauth'
  const via = account ? words.signInProviders[account.provider] : ''
  const status = account && expired ? 'expired' : (account?.status ?? 'untested')

  const run = async (kind: 'connect' | 'test' | 'other' | 'signin', act: () => Promise<void>) => {
    setBusy(kind)
    setFailure(null)
    try {
      await act()
    } catch (error) {
      if (error instanceof Error && error.message === 'not https') setFailure(words.signIn.badLink)
      else {
        if (kind === 'test' && isApiError(error) && error.code === 'OAUTH_EXPIRED') setExpired(true)
        setFailure(refusalOf(error))
      }
    } finally {
      setBusy(null)
    }
  }
  const refresh = async () => setAccount(await read())

  const connect = () => {
    const secret = key.trim()
    if (!secret) return setFailure(words.key.missing)
    void run('connect', async () => {
      await connectStoreAiAccount(provider, secret)
      setKey('')
      await refresh()
      onToast(words.connect.done)
    })
  }
  const goToProvider = (p: AiProvider) =>
    void run('signin', async () => {
      const url = await beginStoreAiOauth(p)
      if (!isHttps(url)) throw new Error('not https')
      window.open(url, '_blank', 'noopener,noreferrer')
      setPending(p)
      setPasted('')
    })
  const finishSignIn = () => {
    const answer = pasted.trim()
    if (!answer) return setFailure(words.signIn.missing)
    void run('signin', async () => {
      await finishStoreAiOauth(answer)
      const done = pending
      setPending(null)
      setPasted('')
      setExpired(false)
      await refresh()
      onToast(fill(words.signIn.connected, { provider: done ? words.signInProviders[done] : '' }))
    })
  }
  const test = () =>
    void run('test', async () => {
      const status = await testStoreAiAccount()
      setExpired(false)
      await refresh()
      onToast(status === 'ok' ? (oauth ? fill(words.signIn.tested, { provider: via }) : words.account.tested) : oauth ? words.signIn.testedRejected : words.account.testedRejected)
    })
  const toggle = (account: StoreAiAccount) =>
    void run('other', async () => {
      await setStoreAiSwitch(!account.useWhenPlanUsed)
      await refresh()
      onToast(account.useWhenPlanUsed ? words.switch.turnedOff : words.switch.turnedOn)
    })
  const askRemove = () =>
    setAsk({
      title: oauth ? fill(words.signIn.removeTitle, { provider: via }) : words.account.removeTitle,
      target: account ? words.providers[account.provider] : '',
      consequence: oauth ? fill(words.signIn.removeBody, { provider: via }) : words.account.removeBody,
      confirmLabel: oauth ? words.signIn.removeGo : words.account.removeGo,
      danger: true,
      onConfirm: () =>
        void run('other', async () => {
          await removeStoreAiAccount()
          setAccount(null)
          setExpired(false)
          onToast(oauth ? fill(words.signIn.removed, { provider: via }) : words.account.removed)
        }),
    })

  const name = account ? words.providers[account.provider] : ''
  return (
    <div className="df-set-store df-dev">
      <div className="df-dev-head">
        <div>
          <h2 className="df-set-title">{words.title}</h2>
          <p className="df-set-sub">{words.sub}</p>
        </div>
      </div>
      {runs && (
        <section className="df-set-card" aria-labelledby={`${id}-plan`}>
          <div className="df-dev-head">
            <h2 id={`${id}-plan`}>{words.plan.title}</h2>
            <span className="df-set-help">{fill(runs.allowed === null ? words.plan.unlimited : words.plan.of, { used: formatCount(runs.used), allowed: formatCount(runs.allowed ?? 0) })}</span>
          </div>
          <p className="df-set-text">{words.plan.body}</p>
        </section>
      )}
      {failure && (
        <p className="df-set-failure" role="alert">
          {failure}
        </p>
      )}
      {!account && (
        <>
          <section className="df-set-card" aria-labelledby={`${id}-claude`}>
            <div className="df-dev-head">
              <h2 id={`${id}-claude`}>{words.claude.title}</h2>
              {!signIn.anthropic && <span className="df-ops-status">{words.signIn.badge}</span>}
            </div>
            <p className="df-set-text">{signIn.anthropic ? words.claude.ready : words.signIn.off}</p>
            <div className="df-dev-buttons">
              <button type="button" className="df-button df-button--primary" disabled={signInBusy || !signIn.anthropic} onClick={() => goToProvider('anthropic')}>
                {busy === 'signin' && pending === null ? words.signIn.opening : words.claude.go}
              </button>
            </div>
          </section>
          <section className="df-set-card" aria-labelledby={`${id}-chatgpt`}>
            <div className="df-dev-head">
              <h2 id={`${id}-chatgpt`}>{words.chatgpt.title}</h2>
              {!signIn.openai && <span className="df-ops-status">{words.signIn.badge}</span>}
            </div>
            <p className="df-set-text">{signIn.openai ? words.chatgpt.ready : words.signIn.off}</p>
            <div className="df-dev-buttons">
              <button type="button" className="df-button df-button--primary" disabled={signInBusy || !signIn.openai} onClick={() => goToProvider('openai')}>
                {busy === 'signin' && pending === null ? words.signIn.opening : words.chatgpt.go}
              </button>
            </div>
          </section>
        </>
      )}
        {pending && (
          <section className="df-set-card" aria-labelledby={`${id}-paste`}>
            <h2 id={`${id}-paste`}>{fill(words.signIn.pasteTitle, { provider: words.signInProviders[pending] })}</h2>
            <p className="df-set-text">{words.signIn.pasteBody}</p>
            <div className="df-set-field">
              <label htmlFor={`${id}-pasted`}>{words.signIn.pasteLabel}</label>
              <input id={`${id}-pasted`} type="password" autoComplete="off" value={pasted} disabled={signInBusy} onChange={(e) => setPasted(e.target.value)} />
            </div>
            <div className="df-dev-buttons">
              <button type="button" className="df-button df-button--primary" disabled={signInBusy} onClick={finishSignIn}>
                {busy === 'signin' ? words.signIn.finishing : words.signIn.finish}
              </button>
              <button type="button" className="df-button" disabled={signInBusy} onClick={() => { setPending(null); setPasted('') }}>
                {words.cancel}
              </button>
            </div>
          </section>
        )}
      {!account && (
        <section className="df-set-card" aria-labelledby={`${id}-connect`}>
          <h2 id={`${id}-connect`}>{words.key.title}</h2>
          <p className="df-set-text">{words.key.body}</p>
          <div className="df-set-grid">
            <div className="df-set-field">
              <label htmlFor={`${id}-provider`}>{words.key.provider}</label>
              <select id={`${id}-provider`} value={provider} disabled={signInBusy} onChange={(e) => setProvider(aiProviders.find((p) => p === e.target.value) ?? 'anthropic')}>
                {aiProviders.map((p) => (
                  <option key={p} value={p}>
                    {words.providers[p]}
                  </option>
                ))}
              </select>
            </div>
            <div className="df-set-field">
              <label htmlFor={`${id}-key`}>{words.key.key}</label>
              <input id={`${id}-key`} type="password" autoComplete="off" value={key} disabled={signInBusy} placeholder={words.keyHints[provider]} onChange={(e) => setKey(e.target.value)} />
            </div>
          </div>
          <div className="df-dev-buttons">
            <button type="button" className="df-button df-button--primary" disabled={signInBusy} onClick={connect}>
              {busy === 'connect' ? words.key.checking : words.key.go}
            </button>
          </div>
        </section>
      )}
      {account && (
        <>
          <section className="df-set-card" aria-label={words.account.label}>
            <div className="df-dev-head">
              <span className="df-dev-cell">
                <strong>{oauth ? (account.accountLabel ?? words.signIn.name) : name}</strong>
                <span className="df-dev-muted">{oauth ? words.signIn.via : `${account.keyPrefix}…`}</span>
              </span>
              <span className="df-dev-buttons">
                <span className={status === 'ok' ? 'df-ops-status df-ops-status--ok' : status === 'untested' ? 'df-ops-status' : 'df-ops-status df-ops-status--warn'}>{words.status[status]}</span>
                {oauth && (
                  <button type="button" className="df-button" disabled={signInBusy || !signIn[account.provider]} onClick={() => goToProvider(account.provider)}>
                    {words.signIn.reconnect}
                  </button>
                )}
                <button type="button" className="df-button" disabled={ro} onClick={test}>
                  {busy === 'test' ? words.account.testing : words.account.test}
                </button>
                <button type="button" className="df-button" disabled={ro} onClick={askRemove}>
                  {oauth ? words.signIn.disconnect : words.account.remove}
                </button>
              </span>
            </div>
            <span className="df-set-help">{account.lastTestedAt ? fill(words.account.lastTested, { time: formatTime(account.lastTestedAt) }) : words.account.neverTested}</span>
            {status === 'expired' && <p className="df-set-warning">{words.signIn.expired}</p>}
            {status === 'rejected' && <p className="df-set-warning">{oauth ? words.signIn.rejected : fill(words.account.rejected, { provider: name })}</p>}
          </section>
          <section className="df-set-card" aria-label={words.switch.label}>
            <label className="df-ops-pick">
              <input type="checkbox" role="switch" checked={account.useWhenPlanUsed} disabled={ro} onChange={() => toggle(account)} />
              <span className="df-ops-text">
                <strong>{words.switch.label}</strong>
                <span>{account.useWhenPlanUsed ? words.switch.on : words.switch.off}</span>
              </span>
            </label>
            <p className="df-set-text">{oauth ? words.switch.bodySignIn : fill(words.switch.body, { provider: name })}</p>
          </section>
        </>
      )}
      <section className="df-set-card" aria-labelledby={`${id}-call`}>
        <h2 id={`${id}-call`}>{words.call.title}</h2>
        <p className="df-set-text">{fill(words.call.body, { path: words.call.path })}</p>
      </section>
      {ask && (
        <ConfirmDialog
          key={ask.title}
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
