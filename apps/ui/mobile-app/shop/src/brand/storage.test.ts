import AsyncStorage from '@react-native-async-storage/async-storage'
import type { Brand } from '../api/store'
import { readSavedBrand, saveBrand } from './storage'

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'))

const brand: Brand = { name: 'Juniper & Co.', logo: 'https://juniper.my-store.one/shop-api/assets/1', mark: null }

describe('the look saved on the device', () => {
  beforeEach(() => AsyncStorage.clear())

  it('reads back what it saved', async () => {
    await saveBrand('juniper.my-store.one', brand)
    await expect(readSavedBrand('juniper.my-store.one')).resolves.toEqual(brand)
  })

  it("never reads another store's look", async () => {
    await saveBrand('juniper.my-store.one', brand)
    await expect(readSavedBrand('other.my-store.one')).resolves.toBeNull()
  })

  it('reads nothing, rather than a guess, from something that is not a brand', async () => {
    await AsyncStorage.setItem('df.brand.juniper.my-store.one', '{"name":7}')
    await expect(readSavedBrand('juniper.my-store.one')).resolves.toBeNull()
    await AsyncStorage.setItem('df.brand.juniper.my-store.one', 'not json')
    await expect(readSavedBrand('juniper.my-store.one')).resolves.toBeNull()
  })
})
