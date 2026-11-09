import { describe, expect, it } from 'vitest'
import { newChoice, newPrice, newQuestion, questionProblems, questionsDraftOf, questionsInputOf, type StoredQuestion } from './productQuestions'

// The editor's questions (CATALOG-DESIGN §6 U): read from the Store API, checked as the form shows them, and sent back as
// ProductInput.questions names them (conditions, versions and version amounts by position in the same input).

const price = (amount: string, more: Partial<StoredQuestion['price'] & object> = {}) => ({ mode: 'FIXED', per: 'ITEM', percentBps: null, amounts: [{ currency: 'INR', amount }], versionAmounts: [], ...more })
const stored: StoredQuestion[] = [
  {
    id: 'q1',
    kind: 'CHOICE',
    label: 'Gift wrap',
    help: null,
    required: false,
    minPicks: 0,
    maxPicks: 1,
    freePicks: 0,
    maxLength: null,
    multiline: null,
    example: null,
    accept: null,
    maxFiles: null,
    price: null,
    shownIf: null,
    versionIds: null,
    choices: [{ id: 'c1', label: 'Yes', photoAssetId: null, available: true, maxQuantity: 1, price: price('5000', { per: 'LINE', versionAmounts: [{ versionId: 'v2', amounts: [{ currency: 'INR', amount: '7000' }] }] }) }],
  },
  {
    id: 'q2',
    kind: 'TEXT',
    label: 'Message',
    help: 'Up to 20 letters',
    required: true,
    minPicks: null,
    maxPicks: null,
    freePicks: null,
    maxLength: 20,
    multiline: false,
    example: 'Happy birthday',
    accept: null,
    maxFiles: null,
    price: { mode: 'PER_CHARACTER', per: 'ITEM', percentBps: null, amounts: [{ currency: 'INR', amount: '100' }], versionAmounts: [] },
    shownIf: { questionId: 'q1', choiceId: 'c1' },
    versionIds: ['v2'],
    choices: [],
  },
]
const versionKeyOf = (id: string) => ({ v1: 'small', v2: 'large' })[id] ?? null

describe('the editor’s questions', () => {
  it('reads stored questions and sends them back by position, keeping their ids', () => {
    const drafts = questionsDraftOf(stored, 'INR', versionKeyOf)
    expect(drafts[0]?.choices[0]?.price).toMatchObject({ amount: '50.00', per: 'LINE', byVersion: { large: '70.00' } })
    expect(drafts[1]).toMatchObject({ maxLength: '20', example: 'Happy birthday', versions: ['large'] })
    expect(questionProblems(drafts, 'INR')).toEqual([])
    const input = questionsInputOf(drafts, 'INR', ['small', 'large'])
    expect(input[0]).toMatchObject({ id: 'q1', kind: 'CHOICE', required: false, choices: [{ id: 'c1', label: 'Yes', price: { mode: 'FIXED', per: 'LINE', amounts: [{ currency: 'INR', amount: '5000' }], versionAmounts: [{ version: 1, amounts: [{ currency: 'INR', amount: '7000' }] }] } }] })
    // The condition names the first question's first choice, and the one version by its place.
    expect(input[1]).toMatchObject({ id: 'q2', kind: 'TEXT', help: 'Up to 20 letters', shownIf: { question: 0, choice: 0 }, versions: [1], price: { mode: 'PER_CHARACTER', amounts: [{ currency: 'INR', amount: '100' }] } })
  })

  it('stores every version as none (U10), so a version made later is asked too', () => {
    const [question] = questionsDraftOf(stored.slice(1), 'INR', versionKeyOf)
    if (!question) throw new Error('no question')
    expect(questionsInputOf([{ ...question, shownIf: null, versions: ['small', 'large'] }], 'INR', ['small', 'large'])[0]).not.toHaveProperty('versions')
  })

  it('names what stops the save, by question and field', () => {
    const empty = { ...newQuestion('CHOICE'), label: '', choices: [] }
    const priced = { ...newQuestion('UPLOAD'), label: 'Your photo', maxFiles: '9', price: { ...newPrice(), amount: 'abc' } }
    const choice = { ...newChoice(''), maxQuantity: '0' }
    const list = { ...newQuestion('CHOICE'), label: 'Toppings', choices: [choice], maxPicks: '2', minPicks: '3' }
    const fields = questionProblems([empty, priced, list], 'INR').map((p) => [p.question === empty.key ? 'empty' : p.question === priced.key ? 'priced' : 'list', p.field, p.choice === null ? null : 'choice'])
    expect(fields).toEqual([
      ['empty', 'label', null],
      ['empty', 'choices', null],
      ['priced', 'price', null],
      ['priced', 'maxFiles', null],
      ['list', 'picks', null],
      ['list', 'label', 'choice'],
      ['list', 'quantity', 'choice'],
    ])
  })
})
