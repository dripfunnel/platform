import * as WebBrowser from 'expo-web-browser'
import { openPolicy, policies, policyUrl } from './policies'

jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }))

const mockOpen = jest.mocked(WebBrowser.openBrowserAsync)

describe('the legal pages', () => {
  it('are the storefront’s policy pages on the store’s host', () => {
    expect(policies.map(({ kind }) => policyUrl('acme.my-store.one', kind))).toEqual([
      'https://acme.my-store.one/policies/terms/',
      'https://acme.my-store.one/policies/privacy/',
      'https://acme.my-store.one/policies/returns/',
      'https://acme.my-store.one/policies/shipping/',
      'https://acme.my-store.one/policies/legal/',
    ])
  })

  it('open in the in-app browser', async () => {
    mockOpen.mockResolvedValue({ type: 'dismiss' } as unknown as WebBrowser.WebBrowserResult)
    expect(await openPolicy('acme.my-store.one', 'terms')).toBe(true)
    expect(mockOpen).toHaveBeenCalledWith('https://acme.my-store.one/policies/terms/')
  })

  it('say so when the browser could not open', async () => {
    mockOpen.mockRejectedValue(new Error('no browser'))
    expect(await openPolicy('acme.my-store.one', 'terms')).toBe(false)
  })
})
