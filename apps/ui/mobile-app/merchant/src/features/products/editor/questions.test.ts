import type { StoredQuestion } from '../../../api/products'
import { conditionTargets, moveQuestion, newChoice, newPrice, newQuestion, questionProblems, questionsDraftOf, questionsInputOf, withValidConditions, type QuestionDraft } from './questions'

const inr = (amount: string) => ({ currency: 'INR', amount })
const stored = (over: Partial<StoredQuestion>): StoredQuestion => ({
  id: 'q',
  kind: 'TEXT',
  label: 'Question',
  help: null,
  required: false,
  minPicks: null,
  maxPicks: null,
  freePicks: null,
  maxLength: 100,
  multiline: false,
  example: null,
  accept: null,
  maxFiles: null,
  price: null,
  shownIf: null,
  versionIds: null,
  choices: [],
  ...over,
})
const wrap = stored({ id: 'q-wrap', kind: 'CHOICE', label: 'Gift wrap', minPicks: 0, maxPicks: 1, freePicks: 0, choices: [{ id: 'c-yes', label: 'Yes', photoAssetId: null, available: true, maxQuantity: 1, price: null }] })
const note = stored({
  id: 'q-note',
  label: 'Note',
  shownIf: { questionId: 'q-wrap', choiceId: 'c-yes' },
  versionIds: ['v-l'],
  price: { mode: 'FIXED', per: 'ITEM', percentBps: null, amounts: [inr('3000'), { currency: 'USD', amount: '40' }], versionAmounts: [{ versionId: 'v-l', amounts: [inr('4500'), { currency: 'USD', amount: '60' }] }, { versionId: 'v-m', amounts: [{ currency: 'USD', amount: '45' }] }] },
})
const keyOf = (id: string) => ({ 'v-m': 'm', 'v-l': 'l' })[id] ?? null

describe('the questions draft', () => {
  it('reads stored questions with their condition, versions and prices, and sends them back as they came', () => {
    const drafts = questionsDraftOf([wrap, note], 'INR', keyOf)
    expect(drafts[1]?.shownIf).toEqual({ question: drafts[0]?.key, choice: drafts[0]?.choices[0]?.key })
    expect(drafts[1]?.price).toMatchObject({ amount: '30.00', manual: [{ currency: 'USD', amount: '40' }], byVersion: { l: '45.00' } })
    expect(questionsInputOf(drafts, 'INR', ['m', 'l'])[1]).toEqual({
      id: 'q-note',
      kind: 'TEXT',
      label: 'Note',
      shownIf: { question: 0, choice: 0 },
      versions: [1],
      required: false,
      maxLength: 100,
      multiline: false,
      price: {
        mode: 'FIXED',
        per: 'ITEM',
        amounts: [inr('3000'), { currency: 'USD', amount: '40' }],
        versionAmounts: [
          { version: 0, amounts: [{ currency: 'USD', amount: '45' }] },
          { version: 1, amounts: [inr('4500'), { currency: 'USD', amount: '60' }] },
        ],
      },
    })
  })

  it('stores every version ticked as no versions, and a percentage in basis points', () => {
    const q: QuestionDraft = { ...newQuestion('UPLOAD'), label: 'Photo', versions: ['m', 'l'], price: { ...newPrice('PERCENT'), percent: '2.5' } }
    expect(questionsInputOf([q], 'INR', ['m', 'l'])[0]).toEqual({ kind: 'UPLOAD', label: 'Photo', required: false, accept: 'IMAGE', maxFiles: 1, price: { mode: 'PERCENT', per: 'ITEM', percentBps: 250 } })
  })

  it('says what stops a save, in words the form shows by field', () => {
    const list: QuestionDraft = { ...newQuestion('CHOICE'), label: 'Toppings', minPicks: '4', maxPicks: '3', choices: [{ ...newChoice(), label: '' }] }
    const text: QuestionDraft = { ...newQuestion('TEXT'), maxLength: '600', price: { ...newPrice('FIXED'), amount: 'ten' } }
    const fields = questionProblems([list, text], 'INR').map((p) => p.field)
    expect(fields).toEqual(['picks', 'label', 'label', 'price', 'maxLength'])
    expect(questionProblems([{ ...newQuestion('UPLOAD'), label: 'Photo', versions: [] }], 'INR')).toEqual([expect.objectContaining({ field: 'versions' })])
    expect(questionProblems([{ ...newQuestion('UPLOAD'), label: 'Photo', versions: ['gone'] }], 'INR', ['m', 'l'])).toEqual([expect.objectContaining({ field: 'versionsChanged' })])
    expect(questionProblems([{ ...newQuestion('CHOICE'), label: 'Size', choices: [{ ...newChoice(), label: 'Big', price: newPrice('PER_CHARACTER') }] }], 'INR')).toEqual([expect.objectContaining({ field: 'price' })])
  })

  it('keeps a condition only on a list above with no condition of its own, and offers only those', () => {
    const [w, n] = questionsDraftOf([wrap, note], 'INR', keyOf) as [QuestionDraft, QuestionDraft]
    expect(moveQuestion([w, n], 1, -1).map((q) => q.shownIf)).toEqual([null, null])
    expect(conditionTargets([w, n], 1).map((q) => q.key)).toEqual([w.key])
    expect(conditionTargets([w, n], 0)).toEqual([])
    expect(withValidConditions([{ ...w, choices: [] }, n])[1]?.shownIf).toBeNull()
  })
})
