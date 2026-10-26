import { productOperation } from '../../api/catalogue'
import { productAnswer, tee } from '../../testing/fixtures'
import { choose, initialSelection, missingOptions, valueState, versionFor } from './options'

const product = productOperation('x').parse(productAnswer(tee()))
if (!product) throw new Error('the fixture is a product')

describe('which option values can be chosen', () => {
  it('leaves every value that some version has available, and a sold-out one choosable', () => {
    expect(valueState(product, {}, 'o-colour', 'v-sand')).toBe('available')
    expect(valueState(product, {}, 'o-size', 'v-l')).toBe('available')
    expect(valueState(product, { 'o-colour': 'v-sand' }, 'o-size', 'v-l')).toBe('soldOut')
  })

  it('disables a value no version has with the other choices made', () => {
    expect(valueState(product, { 'o-size': 'v-m' }, 'o-colour', 'v-black')).toBe('disabled')
    expect(valueState(product, { 'o-colour': 'v-black' }, 'o-size', 'v-m')).toBe('disabled')
  })

  it('judges a value by the other options only, not by its own current choice', () => {
    expect(valueState(product, { 'o-colour': 'v-sand', 'o-size': 'v-m' }, 'o-colour', 'v-black')).toBe('disabled')
    expect(valueState(product, { 'o-colour': 'v-black', 'o-size': 'v-l' }, 'o-size', 'v-l')).toBe('available')
  })
})

describe('the version the choices name', () => {
  it('is none until every option is chosen', () => {
    expect(versionFor(product, {})).toBeNull()
    expect(versionFor(product, { 'o-colour': 'v-sand' })).toBeNull()
    expect(missingOptions(product, { 'o-colour': 'v-sand' }).map((o) => o.name)).toEqual(['Size'])
  })

  it('is the one version with those choices', () => {
    expect(versionFor(product, { 'o-colour': 'v-black', 'o-size': 'v-l' })?.id).toBe('ver-black-l')
  })

  it('is none for a combination no version has', () => {
    expect(versionFor(product, { 'o-colour': 'v-black', 'o-size': 'v-m' })).toBeNull()
  })

  it('is the only version of a product with no options', () => {
    const plain = { options: [], versions: product.versions.slice(0, 1).map((version) => ({ ...version, choices: {} })) }
    expect(versionFor(plain, {})?.id).toBe('ver-sand-m')
  })
})

describe('choosing', () => {
  it('replaces the choice for that option, and takes back one chosen again', () => {
    expect(choose({ 'o-size': 'v-m' }, 'o-size', 'v-l')).toEqual({ 'o-size': 'v-l' })
    expect(choose({ 'o-size': 'v-m', 'o-colour': 'v-sand' }, 'o-size', 'v-m')).toEqual({ 'o-colour': 'v-sand' })
  })

  it('starts with an option that has a single value already chosen', () => {
    const single = { options: [{ id: 'o', name: 'Size', values: [{ id: 'v', name: 'One size' }] }, ...product.options], versions: product.versions }
    expect(initialSelection(single)).toEqual({ o: 'v' })
    expect(initialSelection(product)).toEqual({})
  })
})
