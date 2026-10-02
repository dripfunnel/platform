import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ConfirmDialog, type ConfirmChoice } from './ConfirmDialog'

const plan: ConfirmChoice = {
  key: 'plan',
  label: 'New plan',
  options: [
    { value: '', label: 'Choose a plan' },
    { value: 'pro', label: 'Pro' },
  ],
  initial: '',
  error: (picked) => (picked === '' ? 'Choose the new plan.' : null),
}
const when: ConfirmChoice = {
  key: 'when',
  label: 'When',
  options: [
    { value: 'next', label: 'From the next billing date' },
    { value: 'now', label: 'Now, with proration' },
  ],
  initial: 'next',
  error: () => null,
}

const render = (choices: readonly ConfirmChoice[]) =>
  renderToString(
    <ConfirmDialog
      open
      title="Change the plan?"
      target="Juniper & Co."
      consequence={(_value, picks) => `${picks.plan || 'no plan'} · ${picks.when ?? ''}`}
      confirmLabel="Change plan"
      cancelLabel="Cancel"
      choices={choices}
      onConfirm={() => undefined}
      onCancel={() => undefined}
    />,
  )

describe('ConfirmDialog with several picks', () => {
  it('labels each pick, starts it at its initial value and words the consequence from the picks', () => {
    const html = render([plan, when])
    const selects = [...html.matchAll(/<select id="([^"]+)"[^>]*>/g)].map((match) => match[1])
    expect(selects).toHaveLength(2)
    for (const id of selects) expect(html).toContain(`<label for="${id}">`)
    expect(html).toContain('<option value="next" selected="">')
    expect(html).toContain('no plan · next')
  })

  it('blocks the confirm on the first pick that will not do, and points at its reason', () => {
    const html = render([plan, when])
    const blocked = /<button type="button" class="df-button df-button--primary" disabled="" aria-describedby="([^"]+)"/.exec(html)?.[1]
    expect(blocked).toBeDefined()
    expect(html).toContain(`<p id="${blocked}" class="df-field-hint">Choose the new plan.</p>`)
    expect(html).toContain(`aria-invalid="true" aria-describedby="${blocked}"`)
  })

  it('confirms once every pick will do', () => {
    const html = render([{ ...plan, initial: 'pro' }, when])
    expect(html).toMatch(/<button type="button" class="df-button df-button--primary"(?! disabled)/)
    expect(html).toContain('pro · next')
  })
})
