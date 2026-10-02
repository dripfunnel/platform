import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { activitySearch, ipPattern } from './activitySearch'

describe('activitySearch', () => {
  it('keeps in the URL exactly what the IP field accepts', () => {
    const search = z.object(activitySearch)
    for (const ip of ['103.21', '2001:db8::1', '10.0.0.1/24', 'x'.repeat(46), `1${'.1'.repeat(30)}`]) {
      expect(search.parse({ ip }).ip === ip).toBe(ipPattern.test(ip))
    }
  })
})
