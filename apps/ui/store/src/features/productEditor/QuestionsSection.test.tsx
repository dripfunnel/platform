// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { messages } from '../../messages'
import { blankDraft, type Draft } from '../common/productDraft'
import { QuestionsSection } from './QuestionsSection'

const api = vi.hoisted(() => ({ searchProductsWithQuestions: vi.fn(), copyProductQuestions: vi.fn() }))
vi.mock('../../api/productEditor', async (actual) => ({ ...(await actual<typeof import('../../api/productEditor')>()), ...api }))

// "Ask the shopper before they buy" (CATALOG-DESIGN §6 U): collapsed and empty for a product without questions, then
// adding, the 10-question limit, deleting with a confirmation, and read-only for a seat that can't edit.

const words = messages.editor.questions

type Copy = { productId: string; revision: number; dirty: boolean; onCopied: () => void } | null
const Harness = ({ disabled = false, start = blankDraft(), copy = null }: { disabled?: boolean; start?: Draft; copy?: Copy }) => {
  const [draft, setDraft] = useState(start)
  return (
    <>
      <QuestionsSection draft={draft} update={(change) => setDraft((d) => change(d))} disabled={disabled} currency="INR" manual={[]} versions={[]} copy={copy} />
      <output data-testid="count">{draft.questions.length}</output>
      <output data-testid="choices">{draft.questions[0]?.choices.map((c) => c.label).join(',')}</output>
    </>
  )
}
const open = () => fireEvent.click(screen.getByRole('button', { name: new RegExp(words.title) }))
const count = () => Number(screen.getByTestId('count').textContent)

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('the questions section', () => {
  it('is collapsed with its hint for a product without questions, and adds one of each type', () => {
    render(<Harness />)
    expect(screen.getByText(words.hint)).toBeTruthy()
    open()
    expect(screen.getByText(words.explain)).toBeTruthy()
    const add = screen.getByRole('group', { name: words.add })
    fireEvent.click(within(add).getByRole('button', { name: words.addText }))
    fireEvent.click(within(add).getByRole('button', { name: words.addChoice }))
    fireEvent.click(within(add).getByRole('button', { name: words.addUpload }))
    expect(count()).toBe(3)
  })

  it('stops at 10 questions and says so', () => {
    render(<Harness />)
    open()
    for (let i = 0; i < 10; i += 1) fireEvent.click(within(screen.getByRole('group', { name: words.add })).getByRole('button', { name: words.addText }))
    expect(count()).toBe(10)
    expect(screen.queryByRole('group', { name: words.add })).toBeNull()
    expect(screen.getByText(words.limit)).toBeTruthy()
  })

  it('deletes a question only after its confirmation', () => {
    render(<Harness />)
    open()
    fireEvent.click(within(screen.getByRole('group', { name: words.add })).getByRole('button', { name: words.addText }))
    fireEvent.click(screen.getByRole('button', { name: words.delete }))
    expect(count()).toBe(1)
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: words.keep }))
    expect(count()).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: words.delete }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: words.deleteYes }))
    expect(count()).toBe(0)
  })

  it('reorders a list’s choices', () => {
    render(<Harness />)
    open()
    fireEvent.click(within(screen.getByRole('group', { name: words.add })).getByRole('button', { name: words.addChoice }))
    fireEvent.click(screen.getByRole('button', { name: words.addChoiceRow }))
    const boxes = screen.getAllByRole('textbox', { name: words.choice })
    fireEvent.change(boxes[0] as HTMLElement, { target: { value: 'Cheese' } })
    fireEvent.change(boxes[1] as HTMLElement, { target: { value: 'Olives' } })
    fireEvent.click(screen.getByRole('button', { name: `${words.moveUp}: Olives` }))
    expect(screen.getByTestId('choices').textContent).toBe('Olives,Cheese')
  })

  it('offers nothing to change to a seat that can’t edit', () => {
    render(<Harness disabled />)
    open()
    expect(screen.queryByRole('group', { name: words.add })).toBeNull()
  })

  it('asks only after a choice list above, and clears a condition that a move would point down', () => {
    render(<Harness />)
    open()
    const add = () => within(screen.getByRole('group', { name: words.add }))
    fireEvent.click(add().getByRole('button', { name: words.addChoice }))
    fireEvent.click(add().getByRole('button', { name: words.addText }))
    fireEvent.change(screen.getAllByRole('textbox', { name: words.choice })[0] as HTMLElement, { target: { value: 'Yes' } })
    const conditions = screen.getAllByRole('combobox', { name: words.onlyWhen })
    expect(conditions).toHaveLength(2)
    // The first question has no list above it to depend on; the second can ask after its "Yes".
    expect((conditions[0] as HTMLSelectElement).options).toHaveLength(1)
    const pick = (conditions[1] as HTMLSelectElement).options[1] as HTMLOptionElement
    fireEvent.change(conditions[1] as HTMLElement, { target: { value: pick.value } })
    // Now depended on, the first question can't take a condition and says why (U9).
    const after = screen.getAllByRole('combobox', { name: words.onlyWhen })
    expect(after.map((c) => (c as HTMLSelectElement).value)).toEqual([pick.value])
    expect(screen.getByText(words.onlyWhenTaken)).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: words.moveUp })[1] as HTMLElement)
    expect(screen.getAllByRole('combobox', { name: words.onlyWhen }).map((c) => (c as HTMLSelectElement).value)).toEqual(['', ''])
  })
})

describe('Copy questions from another product (U12)', () => {
  const copy = { productId: 'p-mine', revision: 4, dirty: false, onCopied: vi.fn() }
  const search = async () => {
    fireEvent.click(screen.getByRole('button', { name: words.copy }))
    return screen.findByRole('button', { name: new RegExp('Birthday cake') }, { timeout: 2000 })
  }

  it('searches products with questions, confirms what it replaces, copies and says what couldn’t come', async () => {
    api.searchProductsWithQuestions.mockResolvedValue([{ id: 'p-cake', name: 'Birthday cake', questionCount: 4 }, { id: 'p-mine', name: 'This one', questionCount: 1 }])
    api.copyProductQuestions.mockResolvedValue({ product: { id: 'p-mine', revision: 5 }, droppedAmounts: 2, droppedVersionLimits: 0, droppedPhotos: 1 })
    render(<Harness copy={copy} />)
    open()
    fireEvent.click(await search())
    expect(screen.queryByRole('button', { name: /This one/ })).toBeNull()
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/This product has none yet/)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: words.copyYes }))
    expect(api.copyProductQuestions).toHaveBeenCalledWith('p-cake', 'p-mine', 4)
    expect(await screen.findByText(/2 amounts and 0 version limits/)).toBeTruthy()
    expect(copy.onCopied).toHaveBeenCalled()
  })

  it('says when the search or the copy fails, and keeps the questions', async () => {
    api.searchProductsWithQuestions.mockRejectedValueOnce(new Error('down'))
    render(<Harness copy={copy} />)
    open()
    fireEvent.click(screen.getByRole('button', { name: words.copy }))
    expect(await screen.findByText(words.copySearchFailed, undefined, { timeout: 2000 })).toBeTruthy()
    api.searchProductsWithQuestions.mockResolvedValue([{ id: 'p-cake', name: 'Birthday cake', questionCount: 4 }])
    api.copyProductQuestions.mockRejectedValue(new Error('down'))
    fireEvent.change(screen.getByRole('textbox', { name: words.copySearch }), { target: { value: 'cake' } })
    fireEvent.click(await screen.findByRole('button', { name: /Birthday cake/ }, { timeout: 2000 }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: words.copyYes }))
    expect(await within(screen.getByRole('dialog')).findByText(words.copyFailed)).toBeTruthy()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: words.keep }))
    expect(count()).toBe(0)
  })

  it('waits for unsaved changes, and offers nothing to a seat that can’t edit', () => {
    const { unmount } = render(<Harness copy={{ ...copy, dirty: true }} />)
    open()
    expect(screen.getByText(new RegExp(words.copySave))).toBeTruthy()
    unmount()
    render(<Harness copy={copy} disabled />)
    open()
    expect(screen.queryByRole('button', { name: words.copy })).toBeNull()
  })
})
