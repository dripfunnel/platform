import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { screenStates, type ScreenState } from './screenState'
import { StateView, type StateWords } from './StateView'

const textOf = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&#x27;/g, "'").replace(/&amp;/g, '&')

// The admin console's words at the time of the move (#110), so the assertions read as before.
const words: StateWords = {
  empty: {
    title: 'No partners yet',
    body: 'Partners are the companies that resell DripFunnel under their own brand. Create the first one and invite its owner.',
    action: 'Create partner',
  },
  loading: {
    label: 'Loading partners',
  },
  error: {
    title: "We couldn't load the partners",
    body: "The admin API didn't answer. Nothing you entered was lost. Try again in a moment.",
    detailsLabel: 'Technical details',
    codeLabel: 'Error code',
    code: 'UNKNOWN',
    requestIdLabel: 'Request id',
    requestId: '7f3a91c2',
    retry: 'Try again',
  },
  denied: {
    action: 'Pause partner',
    reason: 'Only a Super admin can pause a partner.',
  },
  readonly: {
    title: 'You have read-only access',
    body: "Your role can see everything here but can't change anything. Ask a Super admin if you need to.",
  },
  confirm: {
    open: 'Close partner…',
    title: 'Close this partner?',
    target: 'Northstar Commerce',
    consequence: 'Closes Northstar Commerce. Its portal host store.northstar.com stops working.',
    notes: ["This can't be undone here.", 'Its 86 stores stop being reachable on that host.'],
    reason: 'Reason (saved in the activity log)',
    reasonHint: 'Required. Close partner turns on once you give a reason.',
    typeLabel: 'Type Northstar Commerce to confirm',
    typeHint: 'Type the partner name exactly to confirm.',
    typeExpected: 'Northstar Commerce',
    confirm: 'Close partner',
    cancel: 'Cancel',
  },
}
const render = (state: ScreenState) => renderToStaticMarkup(<StateView state={state} words={words} />)

describe('StateView', () => {
  it('renders the empty state with its explanation and one action', () => {
    const text = textOf(render('empty'))
    expect(text).toContain(words.empty.title)
    expect(text).toContain(words.empty.body)
    expect(text).toContain(words.empty.action)
  })

  it('renders loading as skeletons under a status region that starts empty, with no numbers', () => {
    const html = render('loading')
    expect(html).toMatch(/<p role="status"[^>]*><\/p>/)
    expect(html).not.toContain('aria-busy')
    expect(html).toContain('df-skeleton')
    expect(textOf(html)).not.toMatch(/\d/)
  })

  it('renders the error as an alert, plain words before the details, with a retry', () => {
    const html = render('error')
    const text = textOf(html)
    expect(html).toContain('role="alert"')
    expect(html).toContain(`<summary>${words.error.detailsLabel}</summary>`)
    expect(text).toContain(words.error.title)
    expect(text).toContain(words.error.body)
    expect(text.indexOf(words.error.body)).toBeLessThan(text.indexOf(words.error.detailsLabel))
    expect(text).toContain(words.error.retry)
  })

  it('renders permission denied as a disabled control described by its reason', () => {
    const html = render('denied')
    const describedBy = /<button[^>]*disabled=""[^>]*aria-describedby="([^"]+)"/.exec(html)?.[1]
    expect(describedBy).toBeDefined()
    expect(html).toContain(`id="${describedBy ?? ''}">${words.denied.reason}</p>`)
  })

  it('renders the read-only notice in the info palette, not as a warning', () => {
    const html = render('readonly')
    const text = textOf(html)
    expect(text).toContain(words.readonly.title)
    expect(text).toContain(words.readonly.body)
    expect(html).toContain('df-state--info')
    expect(html).not.toContain('df-state--warning')
  })

  it('renders the confirmation trigger with the dialog closed', () => {
    const html = render('confirm')
    expect(textOf(html)).toContain(words.confirm.open)
    expect(html).toMatch(/<dialog(?![^>]*\sopen)/)
  })

  it('asks for a required, labelled reason and holds the confirm until one is given', () => {
    const html = render('confirm')
    const fieldId = /<label for="([^"]+)">/.exec(html)?.[1]
    expect(fieldId).toBeDefined()
    expect(textOf(html)).toContain(words.confirm.reason)
    expect(html).toMatch(new RegExp(`<textarea[^>]*id="${fieldId ?? ''}"[^>]*required`))
    expect(html).toMatch(new RegExp(`<button[^>]*disabled=""[^>]*>${words.confirm.confirm}</button>`))
  })

  it('says why confirm is disabled, in a hint the field and the button both point to', () => {
    const html = render('confirm')
    const hintId = new RegExp(`<p id="([^"]+)"[^>]*>${words.confirm.reasonHint}</p>`).exec(html)?.[1]
    expect(hintId).toBeDefined()
    expect(html).toMatch(new RegExp(`<textarea[^>]*aria-describedby="${hintId ?? ''}"`))
    expect(html).toMatch(new RegExp(`<button[^>]*disabled=""[^>]*aria-describedby="${hintId ?? ''}"`))
  })

  it('lists what else the action affects, as the prototype does', () => {
    const text = textOf(render('confirm'))
    for (const note of words.confirm.notes) expect(text).toContain(note)
  })

  it('makes the worst actions require the target typed exactly, and says so', () => {
    const html = render('confirm')
    const typedId = new RegExp(`<label for="([^"]+)">${words.confirm.typeLabel}</label>`).exec(html)?.[1]
    expect(typedId).toBeDefined()
    expect(html).toMatch(new RegExp(`<input[^>]*id="${typedId ?? ''}"[^>]*required`))
    const hintId = new RegExp(`<p id="([^"]+)"[^>]*>${words.confirm.typeHint}</p>`).exec(html)?.[1]
    expect(hintId).toBeDefined()
    expect(html).toMatch(new RegExp(`<input[^>]*aria-describedby="${hintId ?? ''}"`))
  })

  it('never puts the expected confirmation text where it could be copied from', () => {
    const html = render('confirm')
    const withoutDialogBody = html.replace(/<div class="df-dialog-body">[\s\S]*?<\/div>/, '')
    expect(withoutDialogBody).not.toContain(`value="${words.confirm.typeExpected}"`)
  })

  it('renders something for every state', () => {
    for (const state of screenStates) {
      expect(render(state)).not.toBe('')
    }
  })
})
