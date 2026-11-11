import { act, create } from 'react-test-renderer'
import { t } from '../../messages'
import { inr } from '../../testing/fixtures'
import { ProductCardView } from './ProductCardView'

const card = { id: 'p1', slug: 'tee', name: 'Tee', inStock: true, price: inr('149900'), compareAt: inr('199900'), fromPrice: false, photo: null, badge: null }

const labelOf = (product: Parameters<typeof ProductCardView>[0]['product']): string => {
  let tree!: ReturnType<typeof create>
  act(() => {
    tree = create(<ProductCardView product={product} onOpen={() => undefined} />)
  })
  return tree.root.findAll((node) => typeof node.props.accessibilityLabel === 'string')[0]?.props.accessibilityLabel as string
}

describe("a product card's accessibility label", () => {
  it('names the compare-at price as the original price, with no "Was"', () => {
    const label = labelOf(card)
    expect(label).toBe(`Tee, ₹1,499.00, ${t('product.was', { price: '₹1,999.00' })}`)
    expect(label).not.toContain('Was')
  })

  it('has no old price when the compare-at price equals the price', () => {
    expect(labelOf({ ...card, compareAt: inr('149900') })).toBe('Tee, ₹1,499.00')
  })
})
