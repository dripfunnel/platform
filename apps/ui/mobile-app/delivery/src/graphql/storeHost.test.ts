import { storeHost } from './storeHost'

const mockConstants: { expoConfig: { extra: unknown } } = { expoConfig: { extra: {} } }

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return mockConstants.expoConfig
    },
  },
}))

describe('the store host', () => {
  it("is the build's STORE_HOST", () => {
    mockConstants.expoConfig.extra = { STORE_HOST: 'acme.my-store.one', router: {} }
    expect(storeHost()).toBe('acme.my-store.one')
  })

  it('stops the app when the build has none', () => {
    mockConstants.expoConfig.extra = { router: {} }
    expect(() => storeHost()).toThrow('STORE_HOST')
  })
})
