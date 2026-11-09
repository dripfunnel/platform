// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { messages } from '../../messages'
import { blankDraft, type Draft } from '../common/productDraft'
import { QuestionsSection } from './QuestionsSection'

// "Ask the shopper before they buy" (CATALOG-DESIGN §6 U): collapsed and empty for a product without questions, then
// adding, the 10-question limit, deleting with a confirmation, and read-only for a seat that can't edit.

const words = messages.editor.questions

const Harness = ({ disabled = false, start = blankDraft() }: { disabled?: boolean; start?: Draft }) => {
  const [draft, setDraft] = useState(start)
  return (
    <>
      <QuestionsSection draft={draft} update={(change) => setDraft((d) => change(d))} disabled={disabled} currency="INR" manual={[]} versions={[]} copy={null} />
      <output data-testid="count">{draft.questions.length}</output>
      <output data-testid="choices">{draft.questions[0]?.choices.map((c) => c.label).join(',')}</output>
    </>
  )
}
const open = () => fireEvent.click(screen.getByRole('button', { name: new RegExp(words.title) }))
const count = () => Number(screen.getByTestId('count').textContent)

afterEach(cleanup)

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
    fireEvent.click(within(screen.getByRole('alertdialog', { name: words.delete })).getByRole('button', { name: words.deleteYes }))
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
})
