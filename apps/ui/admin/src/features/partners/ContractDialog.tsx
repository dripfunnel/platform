import { useEffect, useId, useRef, useState } from 'react'
import type { Partner, PartnerContract } from '../../api/partners'
import { fill, messages } from '../../messages'
import { ContractFields } from './ContractFields'
import { currencyOfCountry } from './partnerCurrencies'
import '@dripfunnel/shared/ui/states.css'

const words = messages.partner.contract

// A partner without a contract starts from its country's currency, every term at its strictest.
export const startingContract = (partner: Pick<Partner, 'contract' | 'country'>): PartnerContract =>
  partner.contract ?? { feeCurrency: currencyOfCountry(partner.country ?? '') ?? 'USD', currencies: [], poweredBy: 'required' }

export interface ContractDialogProps {
  partner: Partner | null
  onSave: (partner: Partner, contract: PartnerContract, reason: string) => void
  onCancel: () => void
}

// ConfirmDialog's look and behaviour (shared/ui), with the contract's fields, which it has no slot for.
export const ContractDialog = ({ partner, onSave, onCancel }: ContractDialogProps) => {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const triggerRef = useRef<HTMLElement | null>(null)
  const titleId = useId()
  const bodyId = useId()
  const reasonId = useId()
  const hintId = useId()
  const [contract, setContract] = useState<PartnerContract | null>(null)
  const [reason, setReason] = useState('')
  const open = partner !== null

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (partner && !dialog.open) {
      triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      setContract(startingContract(partner))
      setReason('')
      dialog.showModal()
      cancelRef.current?.focus()
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  return (
    <dialog
      ref={dialogRef}
      className="df-dialog"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onCancel={(event) => {
        event.preventDefault()
        onCancel()
      }}
      onClose={() => triggerRef.current?.focus()}
    >
      <h2 id={titleId}>{fill(words.dialog.title, { name: partner?.name ?? '' })}</h2>
      <div id={bodyId} className="df-dialog-body">
        <p>{words.dialog.consequence}</p>
      </div>
      {contract && <ContractFields value={contract} onChange={setContract} />}
      <div className="df-field">
        <label htmlFor={reasonId}>{words.dialog.reason}</label>
        <textarea id={reasonId} required rows={3} aria-describedby={hintId} value={reason} onChange={(event) => setReason(event.target.value)} />
        <p id={hintId} className="df-field-hint">
          {words.dialog.reasonHint}
        </p>
      </div>
      <div className="df-actions">
        <button ref={cancelRef} type="button" className="df-button" onClick={onCancel}>
          {messages.partner.cancel}
        </button>
        <button
          type="button"
          className="df-button df-button--primary"
          disabled={reason.trim() === ''}
          aria-describedby={reason.trim() === '' ? hintId : undefined}
          onClick={() => partner && contract && onSave(partner, contract, reason.trim())}
        >
          {words.dialog.confirm}
        </button>
      </div>
    </dialog>
  )
}
