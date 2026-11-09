import { describe, expect, it } from 'vitest'
import { characters, checkAnswers, inputOf, snapshotOf, type ShopChoice, type ShopExtraPrice, type ShopQuestion } from './answers'

// PLATFORM-PROMPT §5.4 "Product customisation": which questions count, how a line is priced, how answers are checked.

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const v1 = id(1)
const v2 = id(2)
const fixed = (amount: bigint | null, per: 'item' | 'line' = 'item', byVersion: [string, bigint | null][] = []): ShopExtraPrice => ({ mode: 'fixed', per, bps: null, amount, byVersion: new Map(byVersion) })
const choice = (n: number, price: ShopExtraPrice | null, more: Partial<ShopChoice> = {}): ShopChoice => ({ id: id(n), label: `C${n}`, mainLabel: `C${n}`, position: n, available: true, maxQuantity: 1, photoAssetId: null, price, ...more })
const question = (n: number, more: Partial<ShopQuestion>): ShopQuestion => ({
  id: id(n),
  kind: 'choice',
  label: `Q${n}`,
  mainLabel: `Q${n}`,
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
  shownIfChoiceId: null,
  versionIds: [],
  choices: [],
  ...more,
})

const toppings = question(100, {
  maxPicks: 5,
  freePicks: 1,
  choices: [choice(101, fixed(3000n, 'item', [[v2, 5000n]]), { maxQuantity: 3 }), choice(102, fixed(2000n)), choice(103, { mode: 'percent', per: 'item', bps: 1000, amount: null, byVersion: new Map() })],
})
const wrap = question(200, { choices: [choice(201, fixed(5000n, 'line'))] })
const message = question(300, { kind: 'text', minPicks: null, maxPicks: null, freePicks: null, maxLength: 10, multiline: false, required: true, price: { mode: 'per_character', per: 'item', bps: null, amount: 100n, byVersion: new Map() }, shownIfChoiceId: id(201) })
const largeOnly = question(400, { kind: 'text', minPicks: null, maxPicks: null, freePicks: null, maxLength: 20, multiline: false, required: true, versionIds: [v2] })

describe('pricing a customised line', () => {
  it('adds per-item extras to the unit and once-per-line ones to the line, the cheapest units free', () => {
    const checked = checkAnswers([toppings, wrap], v1, 30000n, [
      { questionId: id(100), choices: [{ choiceId: id(101), quantity: 2 }, { choiceId: id(102) }, { choiceId: id(103) }] },
      { questionId: id(200), choices: [{ choiceId: id(201) }] },
    ])
    expect(checked.problems).toEqual([])
    // 2×3000 + 2000 + 10% of 30000 = 3000: the 2000 one is free.
    expect(checked.unitExtras).toBe(6000n + 3000n)
    expect(checked.lineExtras).toBe(5000n)
    expect(checked.priced[0]?.choices.find((c) => c.choiceId === id(102))).toMatchObject({ free: 1, amount: 0n })
  })

  it('takes a version’s own amount over the general one', () => {
    const noneFree = { ...toppings, freePicks: 0 }
    expect(checkAnswers([noneFree], v2, 45000n, [{ questionId: id(100), choices: [{ choiceId: id(101) }] }]).unitExtras).toBe(5000n)
    expect(checkAnswers([noneFree], v1, 30000n, [{ questionId: id(100), choices: [{ choiceId: id(101) }] }]).unitExtras).toBe(3000n)
  })

  it('prices text per character as the shopper sees them, and asks a shown question only', () => {
    const shown = checkAnswers([wrap, message], v1, 30000n, [
      { questionId: id(200), choices: [{ choiceId: id(201) }] },
      { questionId: id(300), text: '  Asha 👍🏽 ' },
    ])
    expect(characters('Asha 👍🏽')).toBe(6)
    expect(shown.unitExtras).toBe(600n)
    // Without the wrap, the message is hidden: never required, and an answer to it is dropped.
    const hidden = checkAnswers([wrap, message], v1, 30000n, [{ questionId: id(300), text: 'Asha' }])
    expect(hidden.problems).toEqual([])
    expect(hidden.stored).toEqual([])
  })

  it('asks a version-limited question only for its versions', () => {
    expect(checkAnswers([largeOnly], v1, 1n, []).problems).toEqual([])
    expect(checkAnswers([largeOnly], v2, 1n, []).problems).toEqual([{ questionId: id(400), choiceId: null, reason: 'REQUIRED' }])
  })
})

describe('checking answers', () => {
  it('names each problem by question, choice and reason', () => {
    const off = { ...toppings, minPicks: 2, maxPicks: 4, choices: [...toppings.choices, choice(104, fixed(10n), { available: false })] }
    const reasons = (input: Parameters<typeof checkAnswers>[3]) => checkAnswers([off, message, wrap], v1, 100n, input).problems.map((p) => p.reason)
    expect(reasons([{ questionId: id(100), choices: [{ choiceId: id(101) }] }])).toEqual(['TOO_FEW_PICKS'])
    expect(reasons([{ questionId: id(100), choices: [{ choiceId: id(101), quantity: 4 }] }])).toEqual(['QUANTITY_TOO_HIGH'])
    expect(reasons([{ questionId: id(100), choices: [{ choiceId: id(104) }, { choiceId: id(101) }] }])).toEqual(['CHOICE_UNAVAILABLE'])
    expect(reasons([{ questionId: id(100), choices: [{ choiceId: id(101), quantity: 3 }, { choiceId: id(102) }, { choiceId: id(103) }] }])).toEqual(['TOO_MANY_PICKS'])
    expect(reasons([{ questionId: id(999) }, { questionId: id(100), text: 'x' }])).toEqual(['UNKNOWN', 'WRONG_KIND'])
    expect(reasons([{ questionId: id(100), choices: [{ choiceId: id(101) }, { choiceId: id(102) }] }, { questionId: id(200), choices: [{ choiceId: id(201) }] }, { questionId: id(300), text: 'far too long a message' }])).toEqual(['TEXT_TOO_LONG'])
  })

  it('makes a choice with no amount in this currency not available', () => {
    const unsold = question(500, { choices: [choice(501, fixed(null))] })
    expect(checkAnswers([unsold], v1, 1n, [{ questionId: id(500), choices: [{ choiceId: id(501) }] }]).problems[0]?.reason).toBe('CHOICE_UNAVAILABLE')
  })

  it('refuses a priced text or upload answer with no amount in this currency, naming no choice, never pricing it at 0', () => {
    const engraving = question(600, { kind: 'text', minPicks: null, maxPicks: null, freePicks: null, maxLength: 20, multiline: false, price: fixed(null) })
    const photo = question(700, { kind: 'upload', minPicks: null, maxPicks: null, freePicks: null, accept: 'image', maxFiles: 1, price: fixed(null) })
    const checked = checkAnswers([engraving, photo], v1, 1n, [{ questionId: id(600), text: 'Asha' }, { questionId: id(700), uploadIds: [id(701)] }], () => true)
    expect(checked.problems).toEqual([
      { questionId: id(600), choiceId: null, reason: 'CHOICE_UNAVAILABLE' },
      { questionId: id(700), choiceId: null, reason: 'CHOICE_UNAVAILABLE' },
    ])
    expect([checked.unitExtras, checked.lineExtras]).toEqual([0n, 0n])
  })

  it('refuses an upload that isn’t this cart’s', () => {
    const photo = question(600, { kind: 'upload', minPicks: null, maxPicks: null, freePicks: null, accept: 'image', maxFiles: 1 })
    expect(checkAnswers([photo], v1, 1n, [{ questionId: id(600), uploadIds: [id(601)] }]).problems[0]?.reason).toBe('UPLOAD_NOT_FOUND')
    expect(checkAnswers([photo], v1, 1n, [{ questionId: id(600), uploadIds: [id(601), id(602)] }], () => true).problems[0]?.reason).toBe('TOO_MANY_FILES')
  })

  it('keeps answers in one order whatever order they came in, so equal answers are one line', () => {
    const a = checkAnswers([toppings, wrap], v1, 1n, [{ questionId: id(200), choices: [{ choiceId: id(201) }] }, { questionId: id(100), choices: [{ choiceId: id(102) }, { choiceId: id(101) }] }])
    const b = checkAnswers([toppings, wrap], v1, 1n, [{ questionId: id(100), choices: [{ choiceId: id(101) }, { choiceId: id(102) }] }, { questionId: id(200), choices: [{ choiceId: id(201) }] }])
    expect(a.stored).toEqual(b.stored)
    expect(checkAnswers([toppings, wrap], v1, 1n, inputOf(a.stored)).stored).toEqual(a.stored)
  })

  it('snapshots labels and amounts as strings, the main language’s only where it differs', () => {
    const translated = { ...wrap, label: 'Emballage', choices: [{ ...wrap.choices[0], label: 'Oui' } as ShopChoice] }
    const [snap] = snapshotOf(checkAnswers([translated], v1, 1n, [{ questionId: id(200), choices: [{ choiceId: id(201) }] }]).priced) as Record<string, unknown>[]
    expect(snap).toMatchObject({ label: 'Emballage', main_label: 'Q200', amount: '5000', choices: [{ label: 'Oui', main_label: 'C201', unit: '5000', per: 'line' }] })
  })
})
