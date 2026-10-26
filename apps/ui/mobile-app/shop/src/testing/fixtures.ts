// Answers shaped as apps/api schema/shop.graphql sends them (money is minor units in a digit string).
export const inr = (amount: string) => ({ amount, currency: 'INR' })

export const summary = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  slug: `tee-${id}`,
  name: `Tee ${id}`,
  inStock: true,
  price: inr('149900'),
  compareAt: null,
  maxPrice: inr('149900'),
  photo: { alt: null, image: { url: `https://cdn.example/${id}.jpg` } },
  badges: [],
  ...over,
})

export const page = (nodes: unknown[], next: string | null = null, extra: Record<string, unknown> = {}) => ({ nodes, pageInfo: { endCursor: next, hasNextPage: next !== null }, ...extra })

/** A tee in two colours and two sizes; Black exists only in Large. */
export const tee = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  slug: 'tee-p1',
  name: 'Linen Tee',
  description: 'A tee.',
  inStock: true,
  price: inr('149900'),
  compareAt: null,
  maxPrice: inr('169900'),
  badges: [],
  highlights: [],
  options: [
    { id: 'o-colour', name: 'Colour', values: [{ id: 'v-sand', name: 'Sand' }, { id: 'v-black', name: 'Black' }] },
    { id: 'o-size', name: 'Size', values: [{ id: 'v-m', name: 'M' }, { id: 'v-l', name: 'L' }] },
  ],
  versions: [
    { id: 'ver-sand-m', name: 'Sand / M', inStock: true, available: 9, price: inr('149900'), compareAt: null, choices: [{ optionId: 'o-colour', valueId: 'v-sand' }, { optionId: 'o-size', valueId: 'v-m' }] },
    { id: 'ver-sand-l', name: 'Sand / L', inStock: false, available: 0, price: inr('149900'), compareAt: null, choices: [{ optionId: 'o-colour', valueId: 'v-sand' }, { optionId: 'o-size', valueId: 'v-l' }] },
    { id: 'ver-black-l', name: 'Black / L', inStock: true, available: 2, price: inr('169900'), compareAt: inr('199900'), choices: [{ optionId: 'o-colour', valueId: 'v-black' }, { optionId: 'o-size', valueId: 'v-l' }] },
  ],
  photos: [{ alt: 'Front', versionId: null, image: { url: 'https://cdn.example/front.jpg' } }],
  video: null,
  specs: [],
  faqs: [],
  returns: null,
  warranty: null,
  sizeChart: null,
  story: [],
  ...over,
})

export const productAnswer = (product: unknown, pricesIncludeTax = true) => ({ store: { pricesIncludeTax }, product })
