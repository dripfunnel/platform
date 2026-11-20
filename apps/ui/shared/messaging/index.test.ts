import { describe, expect, it } from 'vitest'
import { googleMapsKeyShape } from './index'

describe('googleMapsKeyShape', () => {
  it('takes "AIza" and 35 more letters, digits, dashes or underscores, and nothing else', () => {
    expect(googleMapsKeyShape.test(`AIza${'a'.repeat(35)}`)).toBe(true)
    expect(googleMapsKeyShape.test(`AIza${'Ab1_-'.repeat(7)}`)).toBe(true)
    for (const bad of ['', 'AIza', `AIza${'a'.repeat(34)}`, `AIza${'a'.repeat(36)}`, `AIzb${'a'.repeat(35)}`, `AIza${'a'.repeat(34)}!`, ` AIza${'a'.repeat(35)}`]) expect(googleMapsKeyShape.test(bad)).toBe(false)
  })
})
