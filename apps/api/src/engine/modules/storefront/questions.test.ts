import { describe, expect, it } from 'vitest'
import type { QuestionRow } from '#db/scoped/questions'
import { shopQuestionsOf, type QuestionPricing } from './questions'

// A question's text, help and example reach the shop in the shopper's language (migration 0391's fields), choices by name.

const id = '00000000-0000-4000-8000-000000000001'
const free: QuestionRow = {
  id,
  product_id: '00000000-0000-4000-8000-000000000002',
  kind: 'text',
  label: 'Name to engrave',
  help: 'Up to 20 letters',
  required: true,
  position: 1,
  min_picks: null,
  max_picks: null,
  free_picks: null,
  max_length: 20,
  multiline: false,
  example: 'Asha',
  accept: null,
  max_files: null,
  shown_if_choice_id: null,
  version_ids: [],
  choices: [],
  price_mode: null,
  price_bps: null,
  price_per: null,
  amounts: [],
}
const pricing = { currency: 'INR', market: { currency: 'INR', price_adjustment_bps: 0 }, pricing: {} } as unknown as QuestionPricing

describe('the shop’s questions', () => {
  it('reads a question’s text, help and example in the shopper’s language, the main language’s where none', () => {
    const words = new Map([
      [`question:${id}:name`, 'उकेरने के लिए नाम'],
      [`question:${id}:help`, '20 अक्षर तक'],
      [`question:${id}:example`, 'आशा'],
    ])
    expect(shopQuestionsOf([free], words, pricing)[0]).toMatchObject({ label: 'उकेरने के लिए नाम', mainLabel: 'Name to engrave', help: '20 अक्षर तक', example: 'आशा' })
    expect(shopQuestionsOf([free], new Map(), pricing)[0]).toMatchObject({ label: 'Name to engrave', help: 'Up to 20 letters', example: 'Asha' })
  })
})
