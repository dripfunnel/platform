import { describe, expect, it } from 'vitest'
import { redactSecretsInText } from './secretText'

describe('redactSecretsInText', () => {
  it('removes the credentials a provider might echo, and keeps the message readable', () => {
    const cases: [string, string][] = [
      ['git push https://x-access-token:ghs_abcdefghijklmnopqrstuvwxyz0123@github.com/o/r.git failed', 'ghs_'],
      ['GET https://r2.example/obj?X-Amz-Signature=deadbeefcafe&X-Amz-Expires=60 returned 403', 'deadbeefcafe'],
      ['request failed: Authorization: Bearer cfut_ABCdef1234567890xyz', 'cfut_ABCdef1234567890xyz'],
      ['config error {"api_key": "AKIAABCDEFGHIJKLMNOP"}', 'AKIAABCDEFGHIJKLMNOP'],
      ['token=ghp_0123456789abcdefghijABCDEFGHIJ012345 rejected', 'ghp_0123456789'],
      ['stripe said sk_live_51Habcdefghijklmnop', 'sk_live_51H'],
      ['jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.abcdefghijk expired', 'eyJhbGciOiJIUzI1NiJ9'],
      ['Cloudflare rejected aB3dE5fG7hI9jK1lM3nO5pQ7rS9tU1vW3xY5', 'aB3dE5fG7hI9jK1lM3nO5pQ7rS9tU1vW3xY5'],
      ['authorization: token abcd1234efgh refused', 'abcd1234efgh'],
      ['authorization: bearer abcd1234efgh refused', 'abcd1234efgh'],
      ['{"refresh_token":"1//0gAbc-def","access_token":"abc123xyz"}', 'abc123xyz'],
      ['{"refresh_token":"1//0gAbc-def"}', '1//0gAbc-def'],
      ['x-api-key: k_9f8e7d6c5b4a', 'k_9f8e7d6c5b4a'],
    ]
    for (const [text, secret] of cases) {
      const out = redactSecretsInText(text) ?? ''
      expect(out, text).not.toContain(secret)
      expect(out, text).toContain('[redacted]')
    }
  })

  it('leaves ordinary errors and commit hashes alone', () => {
    for (const plain of [
      'Step firstBuild failed: build of 3f2c1a9e8b7d6c5f4e3d2c1b0a9f8e7d6c5b4a39 exited with code 1 after 912 s',
      'store 3f2a9c1e-8b4d-4e2a-9f10-7c3b2a1d0e9f not found',
      'artifact sha256 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08 mismatched',
    ]) {
      expect(redactSecretsInText(plain)).toBe(plain)
    }
    expect(redactSecretsInText(null)).toBeNull()
  })
})
