import { formatMoney, looksLikeEmail } from '@dripfunnel/shared/format'
import { isApiError } from '@dripfunnel/shared/graphql'
import { ConfirmDialog } from '@dripfunnel/shared/ui'
import { useCallback, useEffect, useRef, useState } from 'react'
import { issueGiftCard, loadGiftCards, type IssuedGiftCard } from '../../api/productKinds'
import { fill, formatDay, locale, messages } from '../../messages'

// "Cards issued" on a gift card product (CatEditor): its cards newest first, each by its last four characters only, and
// "Issue a card" for the Owner and Managers (CATALOG T14). The API refuses everyone else.

const words = messages.editor.kinds.giftCard

type Status = keyof typeof words.status

export const statusOf = (card: IssuedGiftCard, now: Date): Status => {
  if (card.status === 'disabled') return 'disabled'
  if (card.expiresAt && new Date(card.expiresAt) <= now) return 'expired'
  if (Number(card.balance.amount) === 0) return 'usedUp'
  if (!card.sentAt) return 'unsent'
  return Number(card.balance.amount) < Number(card.amount.amount) ? 'partUsed' : 'active'
}

const money = (m: { amount: string; currency: string }) => formatMoney({ amount: Number(m.amount), currency: m.currency }, locale)
const day = (iso: string) => formatDay(iso.slice(0, 10))

export type CardList = { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; rows: IssuedGiftCard[]; next: string | null; more: 'idle' | 'loading' | 'failed' }

export interface IssueAmount {
  versionId: string
  label: string
}

/** `preset` is the ?state= harness's list, shown instead of asking the API. */
export const GiftCardsIssued = ({ productId, productName, amounts, canIssue, onToast, preset }: { productId: string; productName: string; amounts: readonly IssueAmount[]; canIssue: boolean; onToast: (text: string) => void; preset: CardList | null }) => {
  const [list, setList] = useState<CardList>(preset ?? { kind: 'loading' })
  const [issuing, setIssuing] = useState<{ key: string; error: string | null } | null>(null)
  const latest = useRef(0)

  const load = useCallback(() => {
    if (preset) return setList(preset)
    const mine = ++latest.current
    setList({ kind: 'loading' })
    loadGiftCards(productId, null).then(
      ({ rows, next }) => mine === latest.current && setList({ kind: 'ready', rows, next, more: 'idle' }),
      () => mine === latest.current && setList({ kind: 'failed' }),
    )
  }, [productId, preset])
  useEffect(load, [load])

  const more = () => {
    if (list.kind !== 'ready' || !list.next) return
    const mine = ++latest.current
    setList({ ...list, more: 'loading' })
    loadGiftCards(productId, list.next).then(
      ({ rows, next }) => mine === latest.current && setList((l) => (l.kind === 'ready' ? { kind: 'ready', rows: [...l.rows, ...rows], next, more: 'idle' } : l)),
      () => mine === latest.current && setList((l) => (l.kind === 'ready' ? { ...l, more: 'failed' } : l)),
    )
  }

  const issue = (email: string, versionId: string) => {
    if (!issuing) return
    setIssuing({ ...issuing, error: null })
    issueGiftCard({ productId, versionId, recipientEmail: email.trim(), issueKey: issuing.key }).then(
      () => {
        setIssuing(null)
        onToast(fill(words.issued_toast, { email: email.trim() }))
        load()
      },
      (error: unknown) => {
        const refused: Record<string, string | undefined> = words.refused
        const text = (isApiError(error) && refused[error.code]) || words.refused.other
        setIssuing((i) => i && { ...i, error: text })
      },
    )
  }

  const now = new Date()
  return (
    <div className="df-editor-cards">
      <div className="df-editor-cards-head">
        <strong>{words.issued}</strong>
        {canIssue && amounts.length > 0 && (
          // A key per opening: a double click or a retry answers the same card (CATALOG T14).
          <button type="button" className="df-button" onClick={() => setIssuing({ key: crypto.randomUUID(), error: null })}>
            {words.issue}
          </button>
        )}
      </div>
      {list.kind === 'loading' && <p className="df-editor-hint" role="status">{words.loading}</p>}
      {list.kind === 'failed' && (
        <p className="df-editor-problem" role="alert">
          {words.failed}{' '}
          <button type="button" className="df-editor-link" onClick={load}>
            {words.retry}
          </button>
        </p>
      )}
      {list.kind === 'ready' && list.rows.length === 0 && <p className="df-editor-hint">{words.none}</p>}
      {list.kind === 'ready' && list.rows.length > 0 && (
        <ul className="df-editor-card-rows">
          {list.rows.map((card) => {
            const status = statusOf(card, now)
            return (
              <li key={card.id} className="df-editor-card-row">
                <span className="df-editor-card-code">{card.last4 ? fill(words.code, { last4: card.last4 }) : words.notSent}</span>
                <span>{card.recipientName ?? card.recipientEmail}</span>
                <span>{money(card.balance)}</span>
                <span className="df-editor-hint-inline">{card.expiresAt ? fill(status === 'expired' ? words.expired : words.expires, { date: day(card.expiresAt) }) : words.noExpiry}</span>
                <span className={`df-editor-card-status df-editor-card-status--${status}`}>{words.status[status]}</span>
              </li>
            )
          })}
        </ul>
      )}
      {list.kind === 'ready' && list.next && (
        <button type="button" className="df-editor-link" disabled={list.more === 'loading'} onClick={more}>
          {list.more === 'failed' ? words.retry : words.more}
        </button>
      )}
      {issuing && (
        <ConfirmDialog
          open
          title={words.issueTitle}
          target={amounts.length === 1 ? fill(words.issueTarget, { name: productName, amount: amounts[0]?.label ?? '' }) : productName}
          consequence={words.issueBody}
          confirmLabel={words.issueConfirm}
          cancelLabel={messages.editor.cancel}
          error={issuing.error}
          input={{ label: words.issueEmail, type: 'email', initial: '', placeholder: words.issueEmailPlaceholder, error: (value) => (looksLikeEmail(value) ? null : words.issueEmailInvalid) }}
          choices={amounts.length > 1 ? [{ key: 'amount', label: words.issueAmount, options: amounts.map((a) => ({ value: a.versionId, label: a.label })), initial: amounts[0]?.versionId ?? '', error: () => null }] : []}
          onCancel={() => setIssuing(null)}
          onConfirm={(_, value, picks) => issue(value ?? '', picks['amount'] ?? amounts[0]?.versionId ?? '')}
        />
      )}
    </div>
  )
}
