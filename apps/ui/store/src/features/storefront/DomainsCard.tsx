import { ConfirmDialog, copyText, pollWhileVisible, sessionPollMs, StatusPill } from '@dripfunnel/shared/ui'
import { Link } from '@tanstack/react-router'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { StorefrontDomain, StorefrontDomains } from '../../api/storefront'
import { fill, formatTime, messages } from '../../messages'
import { canMakePrimary, domainNote, domainPill, domainRefusal, inProgress, needsRecords, recordsTitle } from './domainView'
import type { StorefrontApi } from './storefrontApi'

const words = messages.storefront.domains

type OwnDomain = StorefrontDomain & { id: string }
const isOwn = (d: StorefrontDomain): d is OwnDomain => d.kind === 'custom' && d.id !== null

export interface DomainsCardProps {
  domains: StorefrontDomains
  onDomains: (domains: StorefrontDomains) => void
  canEdit: boolean
  /** Billing is the Owner's: the plan note links there only for them. */
  canUpgrade: boolean
  api: StorefrontApi
  onToast: (text: string) => void
}

/** Site settings › Domains (PortalStorefront, SAAS §8 "The merchant's side"): the free address, the store's own, and connecting one. */
export const DomainsCard = ({ domains, onDomains, canEdit, canUpgrade, api, onToast }: DomainsCardProps) => {
  const id = useId()
  const [host, setHost] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [checked, setChecked] = useState<string | null>(null)
  const [removing, setRemoving] = useState<OwnDomain | null>(null)

  // Only the newest read lands: a poll answered late never puts back a domain just removed.
  const latest = useRef(0)
  const onDomainsRef = useRef(onDomains)
  onDomainsRef.current = onDomains
  const reload = useCallback(async () => {
    const ask = ++latest.current
    try {
      const next = await api.loadDomains()
      if (ask === latest.current) onDomainsRef.current(next)
    } catch {
      // The list on screen stays; the next poll or action reads it again.
    }
  }, [api])
  const pending = inProgress(domains.domains)
  useEffect(() => (pending ? pollWhileVisible(() => void reload(), sessionPollMs, { doc: document, win: window }) : undefined), [pending, reload])

  const act = async (key: string, work: () => Promise<void>, done?: string) => {
    setBusy(key)
    setProblem(null)
    try {
      await work()
      await reload()
      if (done) onToast(done)
    } catch (error) {
      setProblem(domainRefusal(error))
    } finally {
      setBusy(null)
    }
  }

  const connect = () => {
    if (host.trim() === '') return setProblem(words.hostMissing)
    void act('connect', async () => {
      await api.connectDomain(host.trim())
      setHost('')
      setChecked(null)
    })
  }

  const check = (d: OwnDomain) =>
    void act(`check-${d.id}`, async () => {
      await api.checkDomain(d.id)
      setChecked(d.id)
    })

  const copy = (value: string) =>
    void copyText(value).then((ok) => {
      if (ok) onToast(words.records.copied)
      else setProblem(words.records.notCopied)
    })

  const custom = domains.domains.find(isOwn) ?? null
  return (
    <section className="df-sf-card df-sf-domains" aria-labelledby={`${id}-title`}>
      <div className="df-sf-card-head">
        <h2 id={`${id}-title`}>{words.title}</h2>
        <p className="df-sf-lede">{words.lede}</p>
      </div>
      {problem && (
        <p className="df-sf-failure" role="alert">
          {problem}
        </p>
      )}
      <ul className="df-sf-domain-list">
        {domains.domains.map((d) => (
          <li key={d.id ?? 'free'} className="df-sf-domain">
            <span className="df-sf-domain-name">
              <strong>{d.host}</strong>
              <span>{domainNote(d)}</span>
            </span>
            <StatusPill {...domainPill(d.status)} />
            {d.primary && <span className="df-sf-tag">{words.primary}</span>}
            {canEdit && canMakePrimary(d) && (
              <button type="button" className="df-button df-button--small" aria-label={fill(words.makePrimaryNamed, { host: d.host })} disabled={busy !== null} onClick={() => void act(`primary-${d.id ?? 'free'}`, () => api.makeDomainPrimary(d.id), fill(words.primaryDone, { host: d.host }))}>
                {words.makePrimary}
              </button>
            )}
            {canEdit && isOwn(d) && (
              <button type="button" className="df-sf-link df-sf-link--danger" aria-label={fill(words.removeNamed, { host: d.host })} disabled={busy !== null} onClick={() => setRemoving(d)}>
                {words.remove}
              </button>
            )}
          </li>
        ))}
      </ul>

      {canEdit && !domains.domains.some((d) => d.kind === 'custom') && (
        <div className="df-sf-connect">
          <label htmlFor={`${id}-host`}>{words.connectLabel}</label>
          {domains.customDomainAllowed ? (
            <>
              <span className="df-sf-connect-row">
                <input id={`${id}-host`} value={host} placeholder={words.placeholder} autoComplete="off" spellCheck={false} inputMode="url" onChange={(e) => setHost(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && connect()} />
                <button type="button" className="df-button" disabled={busy !== null} onClick={connect}>
                  {busy === 'connect' ? words.connecting : words.connect}
                </button>
              </span>
              <span className="df-sf-help">{words.sslNote}</span>
            </>
          ) : (
            <span className="df-sf-help">
              {words.planNote}{' '}
              {canUpgrade && (
                <Link to="/billing" className="df-sf-link">
                  {words.plans}
                </Link>
              )}
            </span>
          )}
        </div>
      )}

      {custom && needsRecords(custom) && (
        <div className="df-sf-records" role="group" aria-label={fill(words.records.label, { host: custom.host })}>
          <strong>{recordsTitle(custom)}</strong>
          <span className="df-sf-help">{words.records.body}</span>
          <table className="df-sf-dns">
            <thead>
              <tr>
                <th scope="col">{words.records.type}</th>
                <th scope="col">{words.records.name}</th>
                <th scope="col">{words.records.value}</th>
                <th scope="col">
                  <span className="df-visually-hidden">{words.records.copy}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {custom.records.map((r) => (
                <tr key={`${r.type}-${r.name}`}>
                  <td data-label={words.records.type}>{r.type}</td>
                  <td data-label={words.records.name}>{r.name}</td>
                  <td data-label={words.records.value}>
                    {r.value}
                    {r.found && r.found !== r.value && <span className="df-sf-found">{fill(words.records.found, { found: r.found })}</span>}
                  </td>
                  <td>
                    <button type="button" className="df-button df-button--small" aria-label={fill(words.records.copyNamed, { type: r.type })} onClick={() => copy(r.value)}>
                      {words.records.copy}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {canEdit && (
            <span className="df-sf-check">
              <button type="button" className="df-button" disabled={busy !== null} onClick={() => check(custom)}>
                {busy === `check-${custom.id}` ? words.checking : words.check}
              </button>
              <span className="df-sf-check-note" role="status">
                {checked === custom.id ? words.notYet : custom.checkedAt ? fill(words.checkedAt, { time: formatTime(custom.checkedAt) }) : ''}
              </span>
              <button type="button" className="df-sf-link df-sf-link--danger" aria-label={fill(words.cancelNamed, { host: custom.host })} disabled={busy !== null} onClick={() => void act(`remove-${custom.id}`, () => api.removeDomain(custom.id), fill(words.removed, { host: custom.host }))}>
                {words.cancel}
              </button>
            </span>
          )}
        </div>
      )}

      {removing && (
        <ConfirmDialog
          open
          danger
          title={fill(words.removeTitle, { host: removing.host })}
          target={removing.host}
          consequence={words.removeBody}
          confirmLabel={words.removeConfirm}
          cancelLabel={words.keep}
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            const gone = removing
            setRemoving(null)
            void act(`remove-${gone.id}`, () => api.removeDomain(gone.id), fill(words.removed, { host: gone.host }))
          }}
        />
      )}
    </section>
  )
}
