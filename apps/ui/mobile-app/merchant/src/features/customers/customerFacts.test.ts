import { addressText, orderStatusOf, rowSub, spentText } from './customerFacts'
import { editOf, problemWith, type EditForm } from './editDraft'

const blank: EditForm = { name: 'Ananya Rao', phone: '', line1: '', line2: '', city: '', region: '', postal: '', country: '' }

describe('what the customer screens say from the API’s facts', () => {
  it('words spend one figure a currency, as the API keeps them, and nothing when nothing is paid', () => {
    expect(spentText([])).toBeNull()
    expect(spentText([{ amount: '1229100', currency: 'INR' }])).toBe('₹12,291.00')
    expect(spentText([{ amount: '1229100', currency: 'INR' }, { amount: '5000', currency: 'USD' }])).toBe('₹12,291.00 and $50.00')
  })

  it('shows a row’s city and tags, or its email when it has neither', () => {
    const row = { id: 'c-1', name: 'A', email: 'a@example.in', phone: null, city: 'Pune', tags: ['Repeat'], orders: 0, spent: [] }
    expect(rowSub(row)).toBe('Pune · Repeat')
    expect(rowSub({ ...row, city: null, tags: [] })).toBe('a@example.in')
  })

  it('joins the parts of an address that are there', () => {
    const address = { id: 'a', name: 'A', line1: '14 Cross', line2: null, city: 'Pune', region: null, postalCode: '411001', country: 'IN', phone: null, isDefault: true }
    expect(addressText(address)).toBe('14 Cross, Pune, 411001, IN')
  })

  it('words an order from its three states', () => {
    expect(orderStatusOf('cancelled', 'paid', 'unfulfilled')).toBe('cancelled')
    expect(orderStatusOf('placed', 'refunded', 'fulfilled')).toBe('refunded')
    expect(orderStatusOf('placed', 'paid', 'fulfilled')).toBe('shipped')
    expect(orderStatusOf('placed', 'paid', 'partly_fulfilled')).toBe('partly')
    expect(orderStatusOf('placed', 'paid', 'unfulfilled')).toBe('toShip')
  })
})

describe('the Edit details form', () => {
  it('needs a name', () => {
    expect(problemWith({ ...blank, name: ' ' })).toBe('Type a name')
  })

  it('sends no address when none is typed, and wants a whole one when any is', () => {
    expect(problemWith(blank)).toBeNull()
    expect(editOf(blank).address).toBeNull()
    expect(problemWith({ ...blank, line1: '14 Cross' })).toBe('Fill in the street, city and country, or leave the address empty.')
    expect(problemWith({ ...blank, region: 'Goa' })).toBe('Fill in the street, city and country, or leave the address empty.')
  })

  it('sends a whole address as its parts, trimmed, with the country in capitals', () => {
    const form = { ...blank, phone: ' 123 ', line1: ' 14 Cross ', city: ' Pune ', country: 'in', postal: ' 411001 ' }
    expect(problemWith(form)).toBeNull()
    expect(editOf(form)).toEqual({ name: 'Ananya Rao', phone: '123', address: { name: 'Ananya Rao', line1: '14 Cross', line2: null, city: 'Pune', region: null, postalCode: '411001', country: 'IN' } })
  })
})
