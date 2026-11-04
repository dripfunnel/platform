// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { Editor } from '@tiptap/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { messages } from '../../messages'
import { RichTextField } from './RichTextField'

const words = messages.editor.description

afterEach(cleanup)

const Field = ({ initial, readOnly = false, onChange }: { initial: string; readOnly?: boolean; onChange: (html: string) => void }) => {
  const [value, setValue] = useState(initial)
  return (
    <div>
      <span id="label">{words.label}</span>
      <RichTextField
        value={value}
        readOnly={readOnly}
        labelledBy="label"
        placeholder={words.placeholder}
        onChange={(html) => {
          setValue(html)
          onChange(html)
        }}
      />
      <button type="button" onClick={() => setValue(initial)}>
        Discard
      </button>
    </div>
  )
}

const content = () => document.querySelector<HTMLElement>('.ProseMirror') as HTMLElement
const editorOf = () => (content() as HTMLElement & { editor: Editor }).editor
const run = (work: (editor: Editor) => void) => act(() => work(editorOf()))
const tool = (label: string) => screen.getByRole('button', { name: label })

describe('the description editor (#1216)', () => {
  it('shows the stored formatting, labelled, with its toolbar and no tags as text', () => {
    render(<Field initial={'<p>Soft <strong>cotton</strong> and <em>linen</em></p><ul><li>Hand wash</li></ul><p><a href="https://example.com/care">Care</a></p>'} onChange={() => {}} />)
    expect(screen.getByRole('textbox', { name: words.label })).toBe(content())
    expect(content().querySelector('strong')?.textContent).toBe('cotton')
    expect(content().querySelector('em')?.textContent).toBe('linen')
    expect(content().querySelector('ul > li')?.textContent).toBe('Hand wash')
    expect(content().querySelector('a')?.getAttribute('href')).toBe('https://example.com/care')
    expect(content().textContent).not.toMatch(/<\/?[a-z]/)
    expect(screen.getByRole('toolbar', { name: words.toolbar })).toBeTruthy()
    expect(screen.queryByText(words.placeholder)).toBeNull()
  })

  it('opens text typed before the editor was rich as paragraphs, and changes nothing by opening it', () => {
    const onChange = vi.fn()
    render(<Field initial={'Soft cotton.\nHand wash.\n\nMade in India'} onChange={onChange} />)
    expect([...content().querySelectorAll('p')].map((p) => p.innerHTML)).toEqual(['Soft cotton.<br>Hand wash.', 'Made in India'])
    expect(onChange).not.toHaveBeenCalled()
  })

  it('shows the placeholder while it is empty', () => {
    render(<Field initial="" onChange={() => {}} />)
    expect(screen.getByText(words.placeholder)).toBeTruthy()
  })

  it('makes the selected text bold or italic, and says which is on', () => {
    const onChange = vi.fn()
    render(<Field initial="<p>Soft cotton</p>" onChange={onChange} />)
    run((e) => e.commands.selectAll())
    fireEvent.click(tool(words.tools.bold.label))
    expect(onChange).toHaveBeenLastCalledWith('<p><strong>Soft cotton</strong></p>')
    expect(tool(words.tools.bold.label).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(tool(words.tools.italic.label))
    expect(onChange).toHaveBeenLastCalledWith('<p><strong><em>Soft cotton</em></strong></p>')
  })

  it('makes bulleted and numbered lists, saved as the engine stores them', () => {
    const onChange = vi.fn()
    render(<Field initial="<p>Hand wash</p>" onChange={onChange} />)
    run((e) => e.commands.selectAll())
    fireEvent.click(tool(words.tools.bulleted.label))
    expect(onChange).toHaveBeenLastCalledWith('<ul><li>Hand wash</li></ul>')
    fireEvent.click(tool(words.tools.numbered.label))
    expect(onChange).toHaveBeenLastCalledWith('<ol><li>Hand wash</li></ol>')
  })

  it('adds a link to the selected text, with no target or rel of its own', () => {
    const onChange = vi.fn()
    render(<Field initial="<p>Care guide</p>" onChange={onChange} />)
    run((e) => e.commands.selectAll())
    fireEvent.click(tool(words.tools.link.label))
    fireEvent.change(screen.getByLabelText(words.linkAddress), { target: { value: 'example.com/care' } })
    fireEvent.click(screen.getByRole('button', { name: words.addLink }))
    expect(onChange).toHaveBeenLastCalledWith('<p><a href="https://example.com/care">Care guide</a></p>')
    expect(screen.queryByLabelText(words.linkAddress)).toBeNull()
  })

  it('adds a link with no text selected as its own address, and takes a mailto address', () => {
    const onChange = vi.fn()
    render(<Field initial="" onChange={onChange} />)
    fireEvent.click(tool(words.tools.link.label))
    const input = screen.getByLabelText(words.linkAddress)
    fireEvent.change(input, { target: { value: 'mailto:hi@example.com' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenLastCalledWith('<p><a href="mailto:hi@example.com">mailto:hi@example.com</a></p>')
  })

  it('refuses an address that is not http, https or mailto, and says so', () => {
    const onChange = vi.fn()
    render(<Field initial="<p>Care guide</p>" onChange={onChange} />)
    run((e) => e.commands.selectAll())
    for (const bad of ['javascript:alert(1)', 'ftp://example.com', 'data:text/html,x']) {
      fireEvent.click(tool(words.tools.link.label))
      fireEvent.change(screen.getByLabelText(words.linkAddress), { target: { value: bad } })
      fireEvent.click(screen.getByRole('button', { name: words.addLink }))
      expect(screen.getByText(words.badLink)).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: words.cancelLink }))
    }
    expect(onChange).not.toHaveBeenCalled()
  })

  it('changes and removes a link it is in', () => {
    const onChange = vi.fn()
    render(<Field initial={'<p><a href="https://example.com/old">Care guide</a></p>'} onChange={onChange} />)
    run((e) => e.commands.setTextSelection(3))
    fireEvent.click(tool(words.tools.link.label))
    expect((screen.getByLabelText(words.linkAddress) as HTMLInputElement).value).toBe('https://example.com/old')
    fireEvent.click(screen.getByRole('button', { name: words.removeLink }))
    expect(onChange).toHaveBeenLastCalledWith('<p>Care guide</p>')
  })

  it('keeps nothing outside the subset that is pasted into it', () => {
    const onChange = vi.fn()
    render(<Field initial="" onChange={onChange} />)
    run((e) => e.commands.insertContent('<h2>Title</h2><p onclick="x()">Body <u>under</u> <s>cut</s></p><script>alert(1)</script><img src=x onerror=alert(1)>'))
    const stored = onChange.mock.calls.at(-1)?.[0] as string
    expect(stored).not.toMatch(/<h2|<u>|<s>|<script|<img|onclick|onerror/)
    expect(stored).toContain('Body')
  })

  it('holds the stored limit like a textarea’s maxLength', () => {
    const onChange = vi.fn()
    render(<Field initial="<p>Short</p>" onChange={onChange} />)
    run((e) => e.commands.insertContentAt(e.state.doc.content.size - 1, 'a'.repeat(20_050)))
    expect(onChange.mock.calls.every(([html]) => (html as string).length <= 20_000)).toBe(true)
    expect(content().textContent).toBe('Short')
  })

  it('shows the saved text again when the changes are discarded', () => {
    render(<Field initial="<p>Saved</p>" onChange={() => {}} />)
    run((e) => e.chain().focus('end').insertContent(' and more').run())
    expect(content().textContent).toBe('Saved and more')
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(content().textContent).toBe('Saved')
  })

  it('shows the formatting and can’t be changed when it is read-only', () => {
    render(<Field initial="<p>Soft <strong>cotton</strong></p><ul><li>Hand wash</li></ul>" readOnly onChange={() => {}} />)
    expect(content().getAttribute('contenteditable')).toBe('false')
    expect(content().querySelector('strong')?.textContent).toBe('cotton')
    expect(content().querySelector('ul > li')?.textContent).toBe('Hand wash')
    for (const t of Object.values(words.tools)) expect((tool(t.label) as HTMLButtonElement).disabled).toBe(true)
  })
})
