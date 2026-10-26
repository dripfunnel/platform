import { ApiError } from '@dripfunnel/mobile-shared/graphql'
import { accountOperation, addressInput, requestCode, signIn, signInWaysOperation, verifyCode } from './account'

const address = { name: ' Home ', line1: ' 12 Sample Lane ', line2: '', city: 'Jaipur', region: '', postalCode: '302017', country: 'IN', phone: '+91 98765-43210', pin: { latitude: 26.9, longitude: 75.8 } }

describe('the sign-in ways', () => {
  it('read the two switches, and read no way at all as none', () => {
    expect(signInWaysOperation().parse({ signInOptions: { email: true, phone: false } })).toEqual({ email: true, phone: false })
    expect(signInWaysOperation().parse({ signInOptions: null })).toEqual({ email: false, phone: false })
  })
})

describe('the account read', () => {
  it('is never kept on the phone for offline: it holds the customer’s details', () => {
    expect(accountOperation().slot).toBeNull()
  })

  it('reads the details, the addresses with their pins, and the store’s countries once', () => {
    const read = accountOperation().parse({
      account: {
        name: 'Ana',
        email: 'ana@example.com',
        phone: null,
        addresses: [
          { id: 'a1', name: 'Home', line1: '1 Lake Rd', line2: null, city: 'Jaipur', region: null, postalCode: '302017', country: 'IN', phone: null, isDefault: true, latitude: 26.9, longitude: 75.8 },
          { id: 'a2', name: 'Work', line1: '2 Mall Rd', city: 'Jaipur', country: 'IN', latitude: 26.9, longitude: null },
        ],
      },
      store: { markets: [{ countries: ['IN', 'US'] }, { countries: ['IN'] }] },
    })
    expect(read.countries).toEqual(['IN', 'US'])
    expect(read.account?.addresses[0]).toMatchObject({ id: 'a1', isDefault: true, pin: { latitude: 26.9, longitude: 75.8 }, region: '' })
    expect(read.account?.addresses[1]).toMatchObject({ id: 'a2', isDefault: false, pin: null })
  })

  it('is no account when the API knows none for the token', () => {
    expect(accountOperation().parse({ account: null, store: null })).toEqual({ account: null, countries: [] })
  })

  it('is a bad answer when its shape drifts', () => {
    expect(() => accountOperation().parse({ account: { addresses: [{ name: 'no id' }] }, store: null })).toThrow(ApiError)
  })
})

describe('an address as the API takes it', () => {
  it('trims the words, drops what is empty, tightens the phone, and sends the pin as both halves', () => {
    expect(addressInput(address)).toEqual({ name: 'Home', line1: '12 Sample Lane', line2: null, city: 'Jaipur', region: null, postalCode: '302017', country: 'IN', phone: '+919876543210', latitude: 26.9, longitude: 75.8 })
  })

  it('sends no pin as neither half', () => {
    expect(addressInput({ ...address, pin: null })).toMatchObject({ latitude: null, longitude: null })
  })
})

describe('the sign-in calls', () => {
  it('answer the session token, and send exactly what was typed', async () => {
    const request = jest.fn().mockResolvedValue({ signIn: { sessionToken: 'tok' } })
    await expect(signIn({ request }, 'ana@example.com', 'pw')).resolves.toBe('tok')
    expect(request).toHaveBeenCalledWith(expect.stringContaining('signIn(email: $email, password: $password)'), { email: 'ana@example.com', password: 'pw' })
  })

  it('ask for a code by channel, and check it with a name and password only when they are given', async () => {
    const request = jest.fn().mockResolvedValue({ verifySignInCode: { sessionToken: 'tok2' }, requestSignInCode: true })
    await requestCode({ request }, 'PHONE', '+919876543210')
    expect(request).toHaveBeenLastCalledWith(expect.stringContaining('requestSignInCode'), { channel: 'PHONE', to: '+919876543210' })
    await expect(verifyCode({ request }, { channel: 'PHONE', to: '+919876543210', code: '123456' })).resolves.toBe('tok2')
    expect(request).toHaveBeenLastCalledWith(expect.stringContaining('verifySignInCode'), { channel: 'PHONE', to: '+919876543210', code: '123456', name: null, password: null })
    await verifyCode({ request }, { channel: 'EMAIL', to: 'ana@example.com', code: '123456', name: 'Ana', password: 'a long password' })
    expect(request).toHaveBeenLastCalledWith(expect.anything(), { channel: 'EMAIL', to: 'ana@example.com', code: '123456', name: 'Ana', password: 'a long password' })
  })
})
