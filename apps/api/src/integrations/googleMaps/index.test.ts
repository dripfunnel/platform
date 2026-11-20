import { describe, expect, it } from 'vitest'
import { checkGoogleMapsKey, mapsKeyAnswer } from './index'

const key = `AIza${'a'.repeat(31)}TEST`
const denied = (error_message: string) => ({ status: 'REQUEST_DENIED', error_message })

describe('mapsKeyAnswer', () => {
  it('passes a key Google answers for, with or without results', () => {
    expect(mapsKeyAnswer({ status: 'OK', results: [] })).toEqual({ status: 'ok' })
    expect(mapsKeyAnswer({ status: 'ZERO_RESULTS', results: [] })).toEqual({ status: 'ok' })
  })

  it('names what a refusal says: the key, the API not enabled, a restriction', () => {
    expect(mapsKeyAnswer(denied('The provided API key is invalid. '))).toEqual({ status: 'rejected', problem: 'invalid' })
    expect(mapsKeyAnswer(denied('This API project is not authorized to use this API.'))).toEqual({ status: 'rejected', problem: 'geocoding_disabled' })
    expect(mapsKeyAnswer(denied('Geocoding API has not been used in project 123 before or it is disabled.'))).toEqual({ status: 'rejected', problem: 'geocoding_disabled' })
    expect(mapsKeyAnswer(denied('This IP, site or mobile application is not authorized to use this API key. Request received from IP address 1.2.3.4, with empty referer'))).toEqual({ status: 'rejected', problem: 'restricted' })
    expect(mapsKeyAnswer(denied('Something new we have not seen'))).toEqual({ status: 'rejected', problem: 'other' })
  })

  it('passes a key restricted to websites, which this web service can’t use but which proves the key exists', () => {
    expect(mapsKeyAnswer(denied('API keys with referer restrictions cannot be used with this API.'))).toEqual({ status: 'ok' })
  })

  it('says Google couldn’t be asked for a quota, an unknown error or an answer it doesn’t recognise', () => {
    expect(mapsKeyAnswer({ status: 'OVER_QUERY_LIMIT' })).toEqual({ status: 'unavailable' })
    expect(mapsKeyAnswer({ status: 'UNKNOWN_ERROR' })).toEqual({ status: 'unavailable' })
    expect(mapsKeyAnswer({ nope: true })).toEqual({ status: 'unavailable' })
    expect(mapsKeyAnswer(null)).toEqual({ status: 'unavailable' })
  })
})

describe('checkGoogleMapsKey', () => {
  it('asks Geocoding once, with the hooks host as the referrer, and never puts the key in what it returns', async () => {
    const seen: { url: string; referer: string | null }[] = []
    const fetchImpl: typeof fetch = async (url, init) => {
      seen.push({ url: String(url), referer: new Headers(init?.headers).get('referer') })
      return Response.json(denied('The provided API key is invalid.'))
    }
    const result = await checkGoogleMapsKey(key, { hooksHost: 'hooks.dripfunnel.ai', fetchImpl })
    expect(result).toEqual({ status: 'rejected', problem: 'invalid' })
    expect(JSON.stringify(result)).not.toContain(key)
    expect(seen).toHaveLength(1)
    expect(seen[0]?.referer).toBe('https://hooks.dripfunnel.ai/')
    expect(seen[0]?.url.startsWith('https://maps.googleapis.com/maps/api/geocode/json?')).toBe(true)
  })

  it('says unavailable for a server error, a throttle, a timeout, a network failure and a body that isn’t JSON, with no retry', async () => {
    let calls = 0
    const answers: (() => Promise<Response>)[] = [
      async () => new Response('', { status: 503 }),
      async () => new Response('', { status: 429 }),
      async () => new Response('<html>', { status: 200 }),
      async () => {
        throw new DOMException('timed out', 'TimeoutError')
      },
    ]
    for (const answer of answers) {
      const result = await checkGoogleMapsKey(key, { hooksHost: 'hooks.dripfunnel.ai', fetchImpl: async () => (calls++, answer()) })
      expect(result).toEqual({ status: 'unavailable' })
    }
    expect(calls).toBe(answers.length)
  })
})
