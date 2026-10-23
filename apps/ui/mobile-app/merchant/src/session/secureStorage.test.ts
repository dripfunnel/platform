import { parseLast } from './secureStorage'

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'))

const acting = { storeId: 'a', supplierId: null, storeName: 'Juniper & Co.', role: 'owner', tier: null }

describe('the last store a saved session names', () => {
  it('is read back as it was saved', () => {
    expect(parseLast(JSON.stringify(acting))).toEqual(acting)
  })

  it('takes the role and tier as empty when they are missing, since the API gives them fresh at every start', () => {
    expect(parseLast(JSON.stringify({ storeId: 'a', supplierId: 's1', storeName: 'Juniper & Co.' }))).toEqual({ storeId: 'a', supplierId: 's1', storeName: 'Juniper & Co.', role: '', tier: null })
  })

  it.each([null, 'not json', '{}', JSON.stringify({ storeId: 'a' })])('is none for %s', (saved) => {
    expect(parseLast(saved)).toBeNull()
  })
})
