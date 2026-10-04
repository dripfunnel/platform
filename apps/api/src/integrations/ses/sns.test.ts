import { describe, expect, it } from 'vitest'
import { isSnsUrl, snsMessageSchema, snsVerifier, stringToSign, type SnsMessage } from './sns'

const certUrl = 'https://sns.eu-west-1.amazonaws.com/SimpleNotificationService-abc.pem'

const keys = (await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  false,
  ['sign', 'verify'],
)) as CryptoKeyPair

const signed = async (fields: Omit<SnsMessage, 'Signature' | 'SignatureVersion' | 'SigningCertURL'>, url = certUrl): Promise<SnsMessage> => {
  const message = snsMessageSchema.parse({ ...fields, SignatureVersion: '2', Signature: 'x', SigningCertURL: url })
  const bytes = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(stringToSign(message) ?? ''))
  return { ...message, Signature: btoa(String.fromCharCode(...new Uint8Array(bytes))) }
}

const notification = { Type: 'Notification' as const, MessageId: 'm-1', TopicArn: 'arn:aws:sns:eu-west-1:1:ses-events', Message: '{"eventType":"Bounce"}', Timestamp: '2026-10-05T10:00:00.000Z' }

const verifier = (fetched: string[] = []) =>
  snsVerifier({
    fetchImpl: (async (input: RequestInfo | URL) => {
      fetched.push(String(input))
      return new Response('-----BEGIN CERTIFICATE-----')
    }) as typeof fetch,
    importCertificate: async () => keys.publicKey,
  })

describe('SNS signatures', () => {
  it('accepts a message signed with the certificate at an SNS address, fetching it once', async () => {
    const fetched: string[] = []
    const v = verifier(fetched)
    expect(await v.verify(await signed(notification))).toBe(true)
    expect(await v.verify(await signed({ ...notification, MessageId: 'm-2', Subject: 'Bounce' }))).toBe(true)
    expect(fetched).toEqual([certUrl])
  })

  it('refuses a message changed after signing', async () => {
    const message = await signed(notification)
    expect(await verifier().verify({ ...message, Message: '{"eventType":"Complaint"}' })).toBe(false)
  })

  it('never fetches a certificate from anywhere but SNS over https', async () => {
    const fetched: string[] = []
    for (const url of ['http://sns.eu-west-1.amazonaws.com/c.pem', 'https://evil.example/c.pem', 'https://sns.eu-west-1.amazonaws.com.evil.example/c.pem', 'https://sns.eu-west-1.amazonaws.com/c.txt']) {
      expect(await verifier(fetched).verify(await signed(notification, url))).toBe(false)
    }
    expect(fetched).toEqual([])
  })

  it('signs a subscription confirmation over its own fields', async () => {
    const confirmation = { ...notification, Type: 'SubscriptionConfirmation' as const, Token: 't', SubscribeURL: 'https://sns.eu-west-1.amazonaws.com/?Action=ConfirmSubscription' }
    expect(stringToSign(snsMessageSchema.parse({ ...confirmation, SignatureVersion: '2', Signature: 's', SigningCertURL: certUrl }))).toContain('SubscribeURL\nhttps://sns')
    expect(await verifier().verify(await signed(confirmation))).toBe(true)
  })

  it('only takes SignatureVersion 2', () => {
    expect(snsMessageSchema.safeParse({ ...notification, SignatureVersion: '1', Signature: 's', SigningCertURL: certUrl }).success).toBe(false)
  })

  it('recognises SNS addresses', () => {
    expect(isSnsUrl('https://sns.ap-south-1.amazonaws.com/?Action=ConfirmSubscription')).toBe(true)
    expect(isSnsUrl('https://sns.ap-south-1.amazonaws.com:8443/')).toBe(false)
    expect(isSnsUrl('not a url')).toBe(false)
  })
})
