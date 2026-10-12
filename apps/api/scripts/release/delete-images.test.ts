import { describe, expect, it } from 'vitest'
import { deleteRetiredImages, imageMissing } from './delete-images'

const failure = (stderr: string) => Object.assign(new Error('Command failed'), { stderr })

describe('deleteRetiredImages', () => {
  it('keeps going past a failed delete, and reports it', async () => {
    const marked: string[] = []
    const result = await deleteRetiredImages(['1.0.0', '1.1.0', '1.2.0'], {
      remove: async (version) => {
        if (version === '1.1.0') throw failure('Error: the registry answered 500')
      },
      markDeleted: async (version) => void marked.push(version),
    })
    expect(result).toEqual({ deleted: ['1.0.0', '1.2.0'], failed: ['1.1.0'] })
    expect(marked).toEqual(['1.0.0', '1.2.0'])
  })

  it('records an image already gone from the registry as deleted', async () => {
    const marked: string[] = []
    const result = await deleteRetiredImages(['1.0.0'], {
      remove: () => Promise.reject(failure('✘ [ERROR] Image storefront-build:1.0.0 not found')),
      markDeleted: async (version) => void marked.push(version),
    })
    expect(result).toEqual({ deleted: ['1.0.0'], failed: [] })
    expect(marked).toEqual(['1.0.0'])
  })

  it('counts a delete it could not record as failed, to be tried again', async () => {
    const result = await deleteRetiredImages(['1.0.0', '1.1.0'], {
      remove: async () => undefined,
      markDeleted: async (version) => {
        if (version === '1.0.0') throw new Error('connection lost')
      },
    })
    expect(result).toEqual({ deleted: ['1.1.0'], failed: ['1.0.0'] })
  })
})

describe('imageMissing', () => {
  it('reads wrangler and registry not-found answers, and nothing else', () => {
    expect(imageMissing('Image not found')).toBe(true)
    expect(imageMissing('manifest unknown: 404 Not Found')).toBe(true)
    expect(imageMissing('repository does not exist')).toBe(true)
    expect(imageMissing('Authentication error [code: 10000]')).toBe(false)
    expect(imageMissing('')).toBe(false)
  })
})
