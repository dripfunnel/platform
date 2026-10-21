import { describe, expect, it } from 'vitest'
import { isRedactedField, redactChanges } from './redaction'

describe('the redaction list (LOGGING.md §4.1)', () => {
  it('matches a credential however the field is spelled', () => {
    for (const field of ['password', 'passwordHash', 'password_hash', 'stripe_secret_key', 'apiKey', 'api_key', 'apiKeys', 'refreshTokens', 'privateKey', 'credentials', 'passphrase', 'recoveryCodes', 'clientSecrets', 'sessionId', 'verification_code', 'cardNumber', 'two_factor_secret', 'IBAN', 'accountNumber']) {
      expect([field, isRedactedField(field)]).toEqual([field, true])
    }
  })

  it('keeps fields that only sound alike', () => {
    for (const field of ['postcode', 'country_code', 'name', 'secretary', 'span', 'key_features', 'panel', 'company']) {
      expect([field, isRedactedField(field)]).toEqual([field, false])
    }
  })

  it('redacts a credential inside an object-valued field where it sits', () => {
    expect(
      redactChanges([{ field: 'integration', before: { provider: 'stripe', apiKey: 'sk_live_1', nested: { tokens: ['t1'] } }, after: [{ secret: 's' }] }]),
    ).toEqual([
      {
        field: 'integration',
        before: '{"provider":"stripe","apiKey":"[redacted]","nested":{"tokens":"[redacted]"}}',
        after: '[{"secret":"[redacted]"}]',
        redacted: false,
      },
    ])
  })

  it('records a redacted field as changed with no values and stringifies the rest', () => {
    expect(
      redactChanges([
        { field: 'password', before: 'old', after: 'new' },
        { field: 'limit', before: 5, after: { max: 10 } },
        { field: 'note', before: undefined, after: null },
      ]),
    ).toEqual([
      { field: 'password', before: null, after: null, redacted: true },
      { field: 'limit', before: '5', after: '{"max":10}', redacted: false },
      { field: 'note', before: null, after: null, redacted: false },
    ])
  })
})
