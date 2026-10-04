import { describe, expect, it } from 'vitest'
import { amzDate, authorization } from './sigv4'

describe('SigV4', () => {
  it("matches AWS's worked example (IAM ListUsers, 2015-08-30)", async () => {
    const header = await authorization(
      { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', region: 'us-east-1', service: 'iam' },
      {
        method: 'GET',
        path: '/',
        query: 'Action=ListUsers&Version=2010-05-08',
        headers: { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8', host: 'iam.amazonaws.com', 'x-amz-date': '20150830T123600Z' },
        body: '',
      },
    )
    expect(header).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, SignedHeaders=content-type;host;x-amz-date, ' +
        'Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7',
    )
  })

  it('formats the request time in basic ISO 8601, UTC', () => {
    expect(amzDate(new Date('2015-08-30T12:36:00.123Z'))).toBe('20150830T123600Z')
  })
})
