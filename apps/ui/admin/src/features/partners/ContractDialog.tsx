import { useEffect, useState } from 'react'
import { ConfirmDialog } from '@dripfunnel/shared/ui'
import type { Partner, PartnerContract } from '../../api/partners'
import { fill, messages } from '../../messages'
import { ContractFields } from './ContractFields'
import { currencyOfCountry } from './partnerCurrencies'

const words = messages.partner.contract

// A partner without a contract starts from its country's currency, every term at its strictest.
export const startingContract = (partner: Pick<Partner, 'contract' | 'country'>): PartnerContract =>
  partner.contract ?? { feeCurrency: currencyOfCountry(partner.country ?? '') ?? 'USD', currencies: [], poweredBy: 'required' }

export interface ContractDialogProps {
  partner: Partner | null
  // Why the last save was refused; the dialog stays open with the edit and the reason.
  error: string | null
  onSave: (partner: Partner, contract: PartnerContract, reason: string) => void
  onCancel: () => void
}

export const ContractDialog = ({ partner, error, onSave, onCancel }: ContractDialogProps) => {
  const [contract, setContract] = useState<PartnerContract | null>(null)
  const open = partner !== null

  useEffect(() => {
    if (partner) setContract(startingContract(partner))
  }, [open])

  return (
    <ConfirmDialog
      open={open}
      title={fill(words.dialog.title, { name: partner?.name ?? '' })}
      target={partner?.name ?? ''}
      consequence={words.dialog.consequence}
      confirmLabel={words.dialog.confirm}
      cancelLabel={messages.partner.cancel}
      reason={{ label: words.dialog.reason, hint: words.dialog.reasonHint }}
      error={error}
      onConfirm={(reason) => partner && contract && onSave(partner, contract, reason ?? '')}
      onCancel={onCancel}
    >
      {contract && <ContractFields value={contract} onChange={setContract} />}
    </ConfirmDialog>
  )
}
