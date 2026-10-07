// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Partner } from '../../api/partners'
import { createSampleServer, samplePartners } from '../../api/partnersSample'
import { messages } from '../../messages'
import { ContractDialog } from './ContractDialog'
import { currencyName } from './partnerCurrencies'

// The Set contract dialog (admin FIRST-RELEASE §4.3): the contract's fields, a required reason, and a refusal that keeps the edit.

afterEach(cleanup)

const words = messages.partner.contract
const partner = (): Partner => {
  const found = createSampleServer(samplePartners).get('bz', 'staff-super-admin')
  if (!found) throw new Error('No sample partner bz')
  return found
}
const save = () => screen.getByRole('button', { name: words.dialog.confirm, hidden: true })
const reason = () => screen.getByLabelText(words.dialog.reason)

describe('the contract dialog', () => {
  it('saves nothing until a reason is given, then hands over the contract as edited with the reason', async () => {
    const onSave = vi.fn()
    const target = partner()
    render(<ContractDialog partner={target} error={null} onSave={onSave} onCancel={() => undefined} />)
    expect((save() as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('radio', { name: words.poweredByTerms.removable, hidden: true }))
    fireEvent.change(reason(), { target: { value: '  Contract signed  ' } })
    expect((save() as HTMLButtonElement).disabled).toBe(false)
    await act(async () => fireEvent.click(save()))
    expect(onSave).toHaveBeenCalledExactlyOnceWith(target, expect.objectContaining({ poweredBy: 'removable', currencies: [] }), 'Contract signed')
  })

  it('takes a new fee currency off the other currencies, ticked or not', async () => {
    const onSave = vi.fn()
    render(<ContractDialog partner={partner()} error={null} onSave={onSave} onCancel={() => undefined} />)
    const euro = currencyName('EUR')
    fireEvent.click(screen.getByRole('checkbox', { name: euro, hidden: true }))
    fireEvent.change(screen.getByLabelText(words.feeCurrency), { target: { value: 'EUR' } })
    expect(screen.queryByRole('checkbox', { name: euro, hidden: true })).toBeNull()
    fireEvent.change(reason(), { target: { value: 'Fees in euros' } })
    await act(async () => fireEvent.click(save()))
    expect(onSave).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ feeCurrency: 'EUR', currencies: [] }), 'Fees in euros')
  })

  it('stays open after a refusal, says why, keeps the edit and the reason, and can save again', async () => {
    const onSave = vi.fn()
    const target = partner()
    const { rerender } = render(<ContractDialog partner={target} error={null} onSave={onSave} onCancel={() => undefined} />)
    fireEvent.click(screen.getByRole('radio', { name: words.poweredByTerms.firstYear, hidden: true }))
    fireEvent.change(reason(), { target: { value: 'Amended' } })
    await act(async () => fireEvent.click(save()))
    const refusal = messages.common.failures.CURRENCY_IN_USE
    rerender(<ContractDialog partner={target} error={refusal} onSave={onSave} onCancel={() => undefined} />)
    expect(screen.getByRole('alert', { hidden: true }).textContent).toBe(refusal)
    expect((reason() as HTMLTextAreaElement).value).toBe('Amended')
    expect((screen.getByRole('radio', { name: words.poweredByTerms.firstYear, hidden: true }) as HTMLInputElement).checked).toBe(true)
    expect((save() as HTMLButtonElement).disabled).toBe(false)
    await act(async () => fireEvent.click(save()))
    expect(onSave).toHaveBeenCalledTimes(2)
  })
})
