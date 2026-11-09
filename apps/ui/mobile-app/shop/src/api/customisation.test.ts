import { answersToSend, askedFor, questionsOf, type Question } from './customisation'

// Which questions a version asks and what is sent (CATALOG-DESIGN §3 fact 54; #1373): versions, a condition, empty answers dropped.

const q = (id: string, more: Partial<Question> = {}): Question => ({ id, kind: 'TEXT', label: id, help: null, required: false, minPicks: 0, maxPicks: 1, freePicks: 0, maxLength: 100, multiline: false, example: null, accept: 'IMAGE', maxFiles: 1, versionIds: null, shownIf: null, price: null, choices: [], ...more })
const wrap = q('wrap', { kind: 'CHOICE', choices: [{ id: 'yes', label: 'Yes', available: true, maxQuantity: 1, photoUrl: null, price: null }] })
const note = q('note', { shownIf: { questionId: 'wrap', choiceId: 'yes' } })
const large = q('large', { versionIds: ['v-l'] })

describe('the questions a version asks', () => {
  it('asks a version-limited question only for its versions, and a condition’s only once its choice is picked', () => {
    expect(askedFor([wrap, note, large], 'v-s', []).map((x) => x.id)).toEqual(['wrap'])
    expect(askedFor([wrap, note, large], 'v-l', [{ questionId: 'wrap', choices: [{ choiceId: 'yes', quantity: 1 }] }]).map((x) => x.id)).toEqual(['wrap', 'note', 'large'])
  })

  it('sends only answers to questions still asked, and none that are empty', () => {
    expect(answersToSend([wrap, note, large], 'v-s', [{ questionId: 'note', text: 'hidden' }, { questionId: 'large', text: 'not this version' }])).toEqual([])
    expect(answersToSend([wrap, note], 'v-s', [{ questionId: 'wrap', choices: [{ choiceId: 'yes', quantity: 1 }] }, { questionId: 'note', text: '  ' }])).toEqual([{ questionId: 'wrap', choices: [{ choiceId: 'yes', quantity: 1 }] }])
  })

  it('leaves out a question the app can’t show', () => {
    expect(questionsOf([{ id: 'a', kind: 'TEXT', label: 'A' }, { id: null, kind: 'TEXT', label: 'B' }, { id: 'c', kind: 'DRAWING', label: 'C' }]).map((x) => x.id)).toEqual(['a'])
  })
})
