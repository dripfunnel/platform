import * as Location from 'expo-location'
import { intervalFor, onlineIntervalMs, pickedUpIntervalMs, retime, startTracking, stopTracking } from './tracking'

jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  hasStartedLocationUpdatesAsync: jest.fn(),
  startLocationUpdatesAsync: jest.fn().mockResolvedValue(undefined),
  stopLocationUpdatesAsync: jest.fn().mockResolvedValue(undefined),
}))

const mocked = Location as jest.Mocked<typeof Location>

beforeEach(() => jest.clearAllMocks())

describe('the position interval', () => {
  it('is 60 s online and 15 s once a parcel is picked up', () => {
    expect(intervalFor(false)).toBe(60_000)
    expect(intervalFor(true)).toBe(15_000)
  })

  it('is what the task starts with', async () => {
    await startTracking(false)
    await startTracking(true)
    expect(mocked.startLocationUpdatesAsync.mock.calls.map(([, options]) => options?.timeInterval)).toEqual([onlineIntervalMs, pickedUpIntervalMs])
  })

  it('switches when the delivery does, by starting the task again', async () => {
    mocked.hasStartedLocationUpdatesAsync.mockResolvedValue(true)
    await retime(true)
    expect(mocked.stopLocationUpdatesAsync).toHaveBeenCalledTimes(1)
    expect(mocked.startLocationUpdatesAsync.mock.calls[0]?.[1]?.timeInterval).toBe(pickedUpIntervalMs)
  })

  it('does nothing while the rider is not online', async () => {
    mocked.hasStartedLocationUpdatesAsync.mockResolvedValue(false)
    await retime(true)
    expect(mocked.startLocationUpdatesAsync).not.toHaveBeenCalled()
  })

  it('stops only a task that runs', async () => {
    mocked.hasStartedLocationUpdatesAsync.mockResolvedValue(false)
    await stopTracking()
    expect(mocked.stopLocationUpdatesAsync).not.toHaveBeenCalled()
  })
})
