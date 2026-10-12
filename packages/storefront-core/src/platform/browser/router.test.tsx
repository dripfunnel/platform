// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Provided } from '../../../test/shop'
import { useMediaQuery, useReducedMotion } from './hooks'
import { navigate, setRouterBase, useLocation } from './router'

afterEach(() => {
  cleanup()
  setRouterBase(null)
  vi.restoreAllMocks()
})
beforeEach(() => history.replaceState(null, '', '/'))

const Where = () => {
  const { path, query } = useLocation()
  return <p data-testid="where">{`${path}|${query.toString()}`}</p>
}

describe('useLocation and navigate', () => {
  it('changes the query in place, kept in history, and follows the back button', async () => {
    history.replaceState(null, '', '/search/?q=linen')
    render(<Provided><Where /></Provided>)
    expect(screen.getByTestId('where').textContent).toBe('/search/|q=linen')
    act(() => navigate('/search/?q=linen&sort=name'))
    expect(screen.getByTestId('where').textContent).toBe('/search/|q=linen&sort=name')
    act(() => history.back())
    await vi.waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/search/|q=linen'))
  })

  it('loads another page whole, and goes nowhere off the store', () => {
    const assign = vi.spyOn(location, 'assign').mockImplementation(() => undefined)
    navigate('/cart/')
    expect(assign).toHaveBeenCalledWith('/cart/')
    navigate('//elsewhere.example/')
    navigate('https://elsewhere.example/')
    navigate('/\\elsewhere.example')
    expect(assign).toHaveBeenCalledTimes(1)
  })

  it('never shows the studio frame its session, and keeps it in every address it writes', () => {
    const base = '/__studio/abcdefghijklmnopqrstuv/'
    history.replaceState(null, '', `${base}collections/linen/`)
    setRouterBase(base)
    render(<Provided><Where /></Provided>)
    expect(screen.getByTestId('where').textContent).toBe('/collections/linen/|')
    act(() => navigate('/collections/linen/?sort=name'))
    expect(location.pathname).toBe(`${base}collections/linen/`)
    expect(screen.getByTestId('where').textContent).toBe('/collections/linen/|sort=name')
  })

  it('renders the address it was given where there is no browser', () => {
    expect(renderToString(<Provided address="/_fallback/product/"><Where /></Provided>)).toContain('/_fallback/product/|')
  })
})

describe('the browser hooks', () => {
  it('answer their resting value in a static build', () => {
    const Hooks = () => <p>{`${useMediaQuery('(min-width: 760px)')}|${useReducedMotion()}`}</p>
    expect(renderToString(<Hooks />)).toBe('<p>false|false</p>')
  })
})
