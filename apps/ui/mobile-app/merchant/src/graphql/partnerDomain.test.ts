import { partnerDomain } from './partnerDomain'

const mockConstants: { expoConfig: { extra: unknown } } = { expoConfig: { extra: {} } }

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return mockConstants.expoConfig
    },
  },
}))

describe('the partner domain', () => {
  it("is the build's PARTNER_DOMAIN", () => {
    mockConstants.expoConfig.extra = { PARTNER_DOMAIN: 'store.northstar.com', router: {} }
    expect(partnerDomain()).toBe('store.northstar.com')
  })

  it('stops the app when the build has none', () => {
    mockConstants.expoConfig.extra = { router: {} }
    expect(() => partnerDomain()).toThrow('PARTNER_DOMAIN')
  })
})
