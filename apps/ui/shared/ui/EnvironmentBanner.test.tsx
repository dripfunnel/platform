import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { EnvironmentBanner } from './EnvironmentBanner'

describe('EnvironmentBanner', () => {
  it('names the environment with the words it is given, and marks it by class', () => {
    const words = { name: 'Production', warning: 'Changes here reach real partners, stores and shoppers' }
    const html = renderToStaticMarkup(<EnvironmentBanner environment="prod" words={words} />)
    expect(html).toContain('df-env-banner--prod')
    expect(html).toContain('<strong>Production</strong>')
    expect(html).toContain(words.warning)
  })

  it.each(['dev', 'feature', 'local'] as const)('marks %s as its own environment, never as production', (environment) => {
    const html = renderToStaticMarkup(<EnvironmentBanner environment={environment} words={{ name: 'x', warning: 'y' }} />)
    expect(html).toContain(`df-env-banner--${environment}`)
    expect(html).not.toContain('df-env-banner--prod')
  })
})
