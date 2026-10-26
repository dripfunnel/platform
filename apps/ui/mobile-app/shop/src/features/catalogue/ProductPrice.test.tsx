import { act, create } from 'react-test-renderer'
import { Text } from 'react-native'
import { t } from '../../messages'
import { inr } from '../../testing/fixtures'
import { ProductPrice } from './ProductPrice'

const lines = (props: Parameters<typeof ProductPrice>[0]): string[] => {
  let tree!: ReturnType<typeof create>
  act(() => {
    tree = create(<ProductPrice {...props} />)
  })
  return tree.root.findAllByType(Text).map((node) => node.props.children as string)
}

describe('the price and its tax label', () => {
  it("show the API's amount with the included-tax label when the store's prices include tax", () => {
    expect(lines({ price: inr('149900'), compareAt: null, from: false, pricesIncludeTax: true })).toEqual(['₹1,499.00', t('product.tax.included')])
  })

  it('show the added-tax label when the prices exclude tax, and never a label for a price the API did not give', () => {
    expect(lines({ price: inr('149900'), compareAt: null, from: false, pricesIncludeTax: false })).toEqual(['₹1,499.00', t('product.tax.added')])
    expect(lines({ price: null, compareAt: null, from: false, pricesIncludeTax: true })).toEqual([])
  })

  it('say "From" for a range, and show the compare-at price the API gives, struck through, without working out a saving', () => {
    expect(lines({ price: inr('149900'), compareAt: inr('199900'), from: true, pricesIncludeTax: true })).toEqual([t('product.from', { price: '₹1,499.00' }), '₹1,999.00', t('product.tax.included')])
  })

  it('show no compare-at price when it is the same as the price', () => {
    expect(lines({ price: inr('149900'), compareAt: inr('149900'), from: false, pricesIncludeTax: true })).toEqual(['₹1,499.00', t('product.tax.included')])
  })

  it('read as one sentence to a screen reader, tax label included', () => {
    let tree!: ReturnType<typeof create>
    act(() => {
      tree = create(<ProductPrice price={inr('149900')} compareAt={null} from={false} pricesIncludeTax />)
    })
    expect(tree.root.findAll((node) => node.props.accessibilityLabel === `₹1,499.00, ${t('product.tax.included')}`).length).toBeGreaterThan(0)
  })
})
