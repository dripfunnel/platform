import AsyncStorage from '@react-native-async-storage/async-storage'
import type { Brand } from '../api/brand'
import { readSavedBrand, saveBrand } from './storage'

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'))

const brand: Brand = { productName: 'Northstar', primaryColor: '#0A2A4A', accentColor: null, font: null, corner: 'soft', helpUrl: null, supportUrl: null, supportEmail: null, googleSignIn: false, files: { logoLight: null, logoDark: null, mark: null } }

describe('the look saved on the device', () => {
  beforeEach(() => AsyncStorage.clear())

  it('reads back what it saved', async () => {
    await saveBrand('store.northstar.com', brand)
    await expect(readSavedBrand('store.northstar.com')).resolves.toEqual(brand)
  })

  it("never reads another partner's look", async () => {
    await saveBrand('store.northstar.com', brand)
    await expect(readSavedBrand('store.other.com')).resolves.toBeNull()
  })

  it('reads nothing, rather than a guess, from something that is not a brand', async () => {
    await AsyncStorage.setItem('df.brand.store.northstar.com', '{"productName":7}')
    await expect(readSavedBrand('store.northstar.com')).resolves.toBeNull()
    await AsyncStorage.setItem('df.brand.store.northstar.com', 'not json')
    await expect(readSavedBrand('store.northstar.com')).resolves.toBeNull()
  })
})
