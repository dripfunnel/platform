import { describe, expect, it } from 'vitest'
import { brandCopied } from './brand'
import { claimsIn } from './claims'
import type { RuleId } from './rules'

const refused: [text: string, rule: RuleId][] = [
  ['From ₹1,499', 'content/price'],
  ['Now $20', 'content/price'],
  ['20 € only', 'content/price'],
  ['Just Rs. 999', 'content/price'],
  ['999/- for two', 'content/price'],
  ['MRP 2,000', 'content/price'],
  ['1499 rupees', 'content/price'],
  ['Get 30% off today', 'content/price'],
  ['Save up to 50 percent', 'content/price'],
  ['Flat 200 off', 'content/price'],
  ['Buy one get one', 'content/price'],
  ['रु 499 में', 'content/price'],
  ['20% की छूट', 'content/price'],
  ['Only 3 left', 'content/scarcity'],
  ['just two remaining', 'content/scarcity'],
  ['5 in stock', 'content/scarcity'],
  ['Selling fast', 'content/scarcity'],
  ['Our bestseller', 'content/scarcity'],
  ['12 people are viewing this', 'content/scarcity'],
  ['केवल ३ बचे', 'content/scarcity'],
  ['सीमित स्टॉक', 'content/scarcity'],
  ['Ónly 3 left', 'content/scarcity'],
  ['Only ３ left', 'content/scarcity'],
  ['On­ly 3 left', 'content/scarcity'],
  ['Hurry!', 'content/urgency'],
  ['Last chance to own it', 'content/urgency'],
  ['Today only', 'content/urgency'],
  ['जल्दी करें', 'content/urgency'],
  ['★★★★★', 'content/rating'],
  ['4.8/5', 'content/rating'],
  ['4 out of 5', 'content/rating'],
  ['Rated 5 by our customers', 'content/rating'],
  ['1,200 reviews', 'content/rating'],
  ['10,000+ happy customers', 'content/rating'],
  ['5 में से 4.5', 'content/rating'],
  ['Ends in 02:14:59', 'content/countdown'],
  ['Offer ends tonight', 'content/countdown'],
  ['2 days left', 'content/countdown'],
  ['3h 20m left', 'content/countdown'],
  ['2 घंटे बाकी', 'content/countdown'],
]

const allowed = [
  '100% linen',
  'Made in small batches since 1998',
  'Sizes 6 to 20',
  'Free returns within the window shown at checkout',
  'Read what people say about it',
  'Open 24/7',
  'A few details and your order is on its way',
  'Wash cold, dry flat',
  'Three colours, one cut',
  'Ships in 2 days',
  'मुलायम लिनन से कटे कपड़े',
  'कृपया जल्द लौटें',
  'Our {count} favourite pieces',
]

describe('claimsIn', () => {
  it.each(refused)('finds an invented claim in "%s" (%s)', (text, rule) => {
    expect(claimsIn(text).map((c) => c.rule)).toContain(rule)
  })

  it.each(allowed)('finds none in "%s"', (text) => {
    expect(claimsIn(text)).toEqual([])
  })
})

describe('brandCopied', () => {
  const brand = {
    name: 'Northstar Linen',
    tagline: 'Slow-made linen for warm days',
    email: 'hello@northstar.example',
    phone: '+91 98765 43210',
    address: ['12 Residency Road'],
    socialLinks: ['https://www.instagram.com/northstarlinen/'],
  }
  const copied = brandCopied(brand)

  it.each([
    ['Welcome to NORTHSTAR   linen', 'shop name'],
    ['Nоrthstar Linen', 'shop name'],
    ['Slow-made linen for warm days, always', 'tagline'],
    ['Write to Hello@Northstar.example', 'contact email'],
    ['Call 98765-43210', 'contact phone'],
    ['Call (+91) 98765.43210 today', 'contact phone'],
    ['Call ९८७६५ ४३२१०', 'contact phone'],
    ['Visit 12 Residency Road', 'address'],
    ['instagram.com/northstarlinen', 'social link'],
  ])('finds the store field in "%s"', (text, field) => {
    expect(copied(text)).toBe(field)
  })

  it('leaves words that only share a part of a field, and a short one-word shop name', () => {
    expect(copied('Northstar Linens of the north')).toBeUndefined()
    expect(copied('Soft linen for warm days')).toBeUndefined()
    expect(copied('Ships in 98 days. Order 765 within 4 hours, 3 items, 210 gsm')).toBeUndefined()
    expect(brandCopied({ ...brand, name: 'Home' })('Home')).toBeUndefined()
  })
})

describe('claimsIn on long runs', () => {
  it('reads a file-sized run of digits and separators in linear time', () => {
    const runs = ['1,'.repeat(50_000), '9'.repeat(100_000), '1.'.repeat(50_000), '१'.repeat(100_000), '1h '.repeat(30_000)]
    const start = performance.now()
    for (const run of runs) claimsIn(`${run}x`)
    // Quadratic patterns took several seconds for each 100 KB run, so ten seconds for all five fails them with room for a slow machine.
    expect(performance.now() - start).toBeLessThan(10_000)
  }, 20_000)
})
