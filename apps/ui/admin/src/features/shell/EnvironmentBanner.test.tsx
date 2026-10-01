import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { messages } from '../../messages'
import { EnvironmentBanner } from './EnvironmentBanner'

const words = messages.shell.environment

describe('EnvironmentBanner', () => {
  it('names Production and warns that changes reach real partners', () => {
    const html = renderToStaticMarkup(<EnvironmentBanner environment="production" />)
    expect(html).toContain('df-env-banner--production')
    expect(html).toContain(`<strong>${words.production.name}</strong>`)
    expect(words.production.warning).toMatch(/real partners/)
    expect(html).toContain(words.production.warning)
  })

  it('shows Staging distinctly, with its own class and words', () => {
    const html = renderToStaticMarkup(<EnvironmentBanner environment="staging" />)
    expect(html).toContain('df-env-banner--staging')
    expect(html).not.toContain('df-env-banner--production')
    expect(html).toContain(`<strong>${words.staging.name}</strong>`)
    expect(html).toContain(words.staging.warning)
  })
})
