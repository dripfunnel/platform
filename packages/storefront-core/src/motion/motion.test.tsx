// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react'
import { useEffect } from 'react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { MotionValue } from 'motion/react'
import type * as Core from './index'

// Under prefers-reduced-motion core stops every motion animation a theme makes (storefront ARCHITECTURE §3.4; #1245).
let reduced = true
const listeners = new Set<() => void>()
const list = (query: string) => ({
  get matches() {
    return query === '(prefers-reduced-motion: reduce)' && reduced
  },
  media: query,
  addEventListener: (_: string, listener: () => void) => listeners.add(listener),
  removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
})
const prefer = (reduce: boolean) =>
  act(() => {
    reduced = reduce
    for (const listener of listeners) listener()
  })

let core: typeof Core
beforeAll(async () => {
  vi.stubGlobal('matchMedia', list)
  core = await import('./index')
})
afterEach(() => cleanup())
afterAll(() => vi.unstubAllGlobals())

describe("core's motion under reduced motion", () => {
  it('ends every animation at once, and runs it again once the shopper allows motion', async () => {
    await prefer(true)
    expect(core.MotionGlobalConfig.skipAnimations).toBe(true)
    const value = core.motionValue(0)
    void core.animate(value, 100, { duration: 5 })
    // A skipped animation writes its last frame on motion's next frame.
    await new Promise((done) => setTimeout(done, 100))
    expect(value.get()).toBe(100)

    await prefer(false)
    expect(core.MotionGlobalConfig.skipAnimations).toBe(false)
    const moving = core.motionValue(0)
    const controls = core.animate(moving, 100, { duration: 5 })
    await new Promise((done) => setTimeout(done, 100))
    expect(moving.get()).toBeLessThan(100)
    controls.stop()
  })

  it("ends a motion element's animation at its last frame", async () => {
    await prefer(true)
    const { container } = render(<core.motion.div initial={{ opacity: 1, x: 0 }} animate={{ opacity: 0.5, x: 40 }} transition={{ duration: 5 }} />)
    await act(() => new Promise((done) => setTimeout(done, 100)))
    const style = (container.firstElementChild as HTMLElement | null)?.style
    expect([style?.opacity, style?.transform]).toEqual(['0.5', 'translateX(40px)'])
  })

  it('holds useScroll still, with its progress at its end', async () => {
    await prefer(true)
    const seen: number[] = []
    const Hero = () => {
      const { scrollY, scrollYProgress } = core.useScroll()
      useEffect(() => void seen.push(scrollY.get(), scrollYProgress.get()))
      return null
    }
    render(<Hero />)
    expect(seen.slice(-2)).toEqual([0, 1])
  })

  it('lets useSpring follow its source at once', async () => {
    await prefer(true)
    const source = core.motionValue(0)
    const made: { spring?: MotionValue<number> } = {}
    const Tilt = () => {
      made.spring = core.useSpring(source, { stiffness: 50 })
      return null
    }
    render(<Tilt />)
    act(() => source.set(40))
    expect(made.spring?.get()).toBe(40)
  })

  it('springs as motion does once the shopper allows motion', async () => {
    await prefer(false)
    const source = core.motionValue(0)
    const made: { spring?: MotionValue<number> } = {}
    const Tilt = () => {
      made.spring = core.useSpring(source, { stiffness: 50 })
      return null
    }
    render(<Tilt />)
    act(() => source.set(40))
    expect(made.spring?.get()).toBeLessThan(40)
  })
})
