import { ApiError } from '@dripfunnel/mobile-shared/graphql'
import { errorText, t } from '../../messages'
import type { Rider } from '../../api/rider'
import { fakeSession, fill, hasText, press, render, type Request } from '../../testing/harness'
import { ProfileForm } from './ProfileForm'
import { ProfileScreen } from './ProfileScreen'
import { pickPhoto } from './pickPhoto'

jest.setTimeout(120_000)

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'))

const mockPush = jest.fn()
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }), useFocusEffect: () => undefined }))
jest.mock('./pickPhoto', () => ({ pickPhoto: jest.fn() }))

const rider: Rider = { id: 'r1', name: 'Asha Rao', phone: '+919876543210', photoAssetId: null, vehicleType: 'scooter', vehicleNumber: 'KA01AB1234' }

const profile = (handle: (request: Request) => unknown = () => ({})) => (request: Request) => (request.query === '{ me }' ? { me: rider } : handle(request))

describe('Profile', () => {
  it('shows the rider’s name, number and vehicle', async () => {
    const screen = await render(<ProfileScreen />, fakeSession(profile()))
    expect(hasText(screen, 'Asha Rao')).toBe(true)
    expect(hasText(screen, '+919876543210')).toBe(true)
    expect(hasText(screen, `${t('profile.vehicles.scooter')} · KA01AB1234`)).toBe(true)
  })

  it('states the consequence before deleting, and signs out after the account is gone', async () => {
    const session = fakeSession(profile(() => ({ deleteMyAccount: true })))
    const screen = await render(<ProfileScreen />, session)
    await press(screen, t('profile.deleteAccount'))
    expect(hasText(screen, t('profile.delete.body'))).toBe(true)
    expect(session.requests.some((r) => r.query.includes('deleteMyAccount'))).toBe(false)

    await press(screen, t('profile.delete.confirm'))
    expect(session.requests.some((r) => r.query.includes('deleteMyAccount'))).toBe(true)
    expect(session.events).toEqual(['leave'])
  })

  it('says to finish or return the current delivery when it cannot be deleted', async () => {
    const session = fakeSession(
      profile((request) => {
        if (request.query.includes('deleteMyAccount')) throw new ApiError('RIDER_HAS_PARCEL', 'x')
        return {}
      }),
    )
    const screen = await render(<ProfileScreen />, session)
    await press(screen, t('profile.deleteAccount'))
    await press(screen, t('profile.delete.confirm'))
    expect(hasText(screen, t('profile.delete.refusedTitle'))).toBe(true)
    expect(hasText(screen, t('profile.delete.refusedBody'))).toBe(true)
    expect(session.events).toEqual([])
  })

  it('keeps the account when the rider changes their mind', async () => {
    const session = fakeSession(profile())
    const screen = await render(<ProfileScreen />, session)
    await press(screen, t('profile.deleteAccount'))
    await press(screen, t('profile.delete.keep'))
    expect(session.requests.some((r) => r.query.includes('deleteMyAccount'))).toBe(false)
  })

  it('signs out', async () => {
    const session = fakeSession(profile())
    const screen = await render(<ProfileScreen />, session)
    await press(screen, t('profile.signOut'))
    expect(session.events).toEqual(['signOut'])
  })

  it('says a parcel in hand keeps the rider signed in', async () => {
    const session = fakeSession(profile())
    session.signOut = () => Promise.reject(new ApiError('RIDER_HAS_PARCEL', 'x'))
    const screen = await render(<ProfileScreen />, session)
    await press(screen, t('profile.signOut'))
    expect(hasText(screen, errorText('RIDER_HAS_PARCEL', 'signOut'))).toBe(true)
  })

  it('shows its own state when the phone has no signal, and loads again on retry', async () => {
    let offline = true
    const session = fakeSession((request) => {
      if (offline) throw new ApiError('NO_RESPONSE', 'x')
      return profile()(request)
    })
    session.fetchRider = () => (offline ? Promise.reject(new ApiError('NO_RESPONSE', 'x')) : Promise.resolve(rider))
    const screen = await render(<ProfileScreen />, session)
    expect(hasText(screen, t('states.offline.title'))).toBe(true)
    offline = false
    await press(screen, t('common.retry'))
    expect(hasText(screen, 'Asha Rao')).toBe(true)
  })
})

describe('the profile form', () => {
  const saved = jest.fn()
  const form = (over: Partial<Rider> = {}, mode: 'first' | 'edit' = 'first') => <ProfileForm rider={{ ...rider, name: '', vehicleType: null, vehicleNumber: null, ...over }} mode={mode} storeName="Acme" onSaved={saved} />

  beforeEach(() => saved.mockClear())

  it('needs a name and a vehicle before it asks the API', async () => {
    const session = fakeSession(() => ({}))
    const screen = await render(form(), session)
    await press(screen, t('profile.continue'))
    expect(hasText(screen, t('profile.nameRequired'))).toBe(true)
    expect(hasText(screen, t('profile.vehicleRequired'))).toBe(true)
    expect(session.requests).toHaveLength(0)
  })

  it('saves the name, vehicle and number together, then goes on', async () => {
    const session = fakeSession(() => ({ updateProfile: rider }))
    const screen = await render(form(), session)
    await fill(screen, t('profile.name'), '  Asha Rao ')
    await press(screen, t('profile.vehicles.scooter'))
    await fill(screen, t('profile.vehicleNumber'), 'ka01ab1234')
    await press(screen, t('profile.continue'))
    expect(session.requests[0]?.variables).toEqual({ name: 'Asha Rao', photoAssetId: null, vehicleType: 'scooter', vehicleNumber: 'KA01AB1234' })
    expect(saved).toHaveBeenCalledTimes(1)
  })

  it('asks for no vehicle number on a bicycle or on foot', async () => {
    const session = fakeSession(() => ({ updateProfile: rider }))
    const screen = await render(form({ name: 'Asha Rao', vehicleNumber: 'OLD' }), session)
    await press(screen, t('profile.vehicles.bicycle'))
    expect(hasText(screen, t('profile.vehicleNumber'))).toBe(false)
    await press(screen, t('profile.continue'))
    expect(session.requests[0]?.variables).toMatchObject({ vehicleType: 'bicycle', vehicleNumber: null })
  })

  it('uploads a photo the rider picks and sends its id with the profile', async () => {
    jest.mocked(pickPhoto).mockResolvedValue({ uri: 'file:///me.jpg', mimeType: 'image/jpeg' })
    const session = fakeSession(() => ({ updateProfile: rider }), { photoId: 'asset-7' })
    const screen = await render(form({ name: 'Asha Rao', vehicleType: 'bike' }), session)
    await press(screen, t('profile.photo.add'))
    await press(screen, t('profile.photo.library'))
    expect(session.uploads).toEqual([{ uri: 'file:///me.jpg', mimeType: 'image/jpeg' }])
    await press(screen, t('profile.continue'))
    expect(session.requests[0]?.variables).toMatchObject({ photoAssetId: 'asset-7' })
  })

  it('sends the photo the rider already has when they do not change it', async () => {
    const session = fakeSession(() => ({ updateProfile: rider }))
    const screen = await render(form({ name: 'Asha Rao', vehicleType: 'bike', photoAssetId: 'asset-3' }, 'edit'), session)
    await press(screen, t('profile.save'))
    expect(session.requests[0]?.variables).toMatchObject({ photoAssetId: 'asset-3' })
  })

  it('says how to allow the camera when it is not allowed, and does not upload', async () => {
    jest.mocked(pickPhoto).mockResolvedValue('denied')
    const session = fakeSession(() => ({}))
    const screen = await render(form(), session)
    await press(screen, t('profile.photo.add'))
    await press(screen, t('profile.photo.camera'))
    expect(hasText(screen, t('profile.photo.cameraDenied'))).toBe(true)
    expect(session.uploads).toEqual([])
  })

  it('words a refused save by its code and does not go on', async () => {
    const session = fakeSession(() => {
      throw new ApiError('PHOTO_NOT_FOUND', 'x')
    })
    const screen = await render(form({ name: 'Asha Rao', vehicleType: 'bike' }), session)
    await press(screen, t('profile.continue'))
    expect(hasText(screen, errorText('PHOTO_NOT_FOUND', 'profile'))).toBe(true)
    expect(saved).not.toHaveBeenCalled()
  })
})
