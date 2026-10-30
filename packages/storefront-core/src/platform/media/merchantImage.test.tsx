// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Provided, shopAnswering } from '../../../test/shop'
import { MerchantImage } from './merchantImage'

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('MerchantImage', () => {
  it('asks the Shop API for the asset and draws it with the alt the theme wrote', async () => {
    const asked = shopAnswering(() => ({ data: { shopAsset: { url: 'https://shop.example/shop-api/assets/a1' } } }))
    const view = render(
      <Provided>
        <MerchantImage asset="a1" alt="Our studio" ratio={1.5} />
      </Provided>,
    )
    await settle()
    const img = view.container.querySelector('img')
    expect(img?.getAttribute('src')).toBe('https://shop.example/shop-api/assets/a1')
    expect(img?.getAttribute('alt')).toBe('Our studio')
    expect(asked[0]?.variables).toEqual({ id: 'a1' })
  })

  it('shows nothing for an id that is not a file of the store, and asks nothing for one that is not an id', async () => {
    const asked = shopAnswering(() => ({ data: { shopAsset: null } }))
    const gone = render(
      <Provided>
        <MerchantImage asset="a2" alt="x" ratio={1} />
      </Provided>,
    )
    await settle()
    expect(gone.container.querySelector('img')).toBeNull()
    const bad = render(
      <Provided>
        <MerchantImage asset="https://evil.example/x.png" alt="x" ratio={1} />
      </Provided>,
    )
    await settle()
    expect(bad.container.querySelector('img')).toBeNull()
    expect(asked.map((a) => a.variables)).toEqual([{ id: 'a2' }])
  })
})
