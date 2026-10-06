import { describe, expect, it } from 'vitest'
import { ecbRates, parseReferenceRates } from './rates'

const daily = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
  <gesmes:subject>Reference rates</gesmes:subject>
  <Cube>
    <Cube time='2026-10-02'>
      <Cube currency='USD' rate='1.0812'/>
      <Cube currency='JPY' rate='160.53'/>
      <Cube currency='INR' rate='90.4215'/>
    </Cube>
  </Cube>
</gesmes:Envelope>`

describe('the ECB reference rates', () => {
  it('reads the day and each currency’s rate per euro, as published', () => {
    expect(parseReferenceRates(daily)).toEqual({ publishedOn: '2026-10-02', perEuro: { USD: '1.0812', JPY: '160.53', INR: '90.4215' } })
  })

  it('refuses a file that isn’t the daily one, and a rate that isn’t a plain decimal', () => {
    expect(parseReferenceRates('<html>maintenance</html>')).toBeNull()
    expect(parseReferenceRates(`<Cube time='2026-10-02'><Cube currency='USD' rate='1e3'/></Cube>`)).toBeNull()
  })

  it('fetches the one fixed address and fails loudly on anything else', async () => {
    const asked: string[] = []
    const ok = ecbRates(async (url) => {
      asked.push(String(url))
      return new Response(daily)
    })
    expect((await ok.fetch(AbortSignal.timeout(1000))).perEuro['USD']).toBe('1.0812')
    expect(asked).toEqual(['https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml'])
    await expect(ecbRates(async () => new Response('down', { status: 503 })).fetch(AbortSignal.timeout(1000))).rejects.toThrow(/503/)
  })
})
