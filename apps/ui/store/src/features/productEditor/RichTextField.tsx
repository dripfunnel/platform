import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useEffect, useId, useRef, useState } from 'react'
import { messages } from '../../messages'
import { editorHtmlOf, storedHtmlOf } from '../common/richDescription'

const words = messages.editor.description

/** The engine's limit on a stored description (apps/api catalog rules). */
const limit = 20_000

const address = /^(https?:\/\/[^/?#\s]|mailto:\S)/i

// Only what the engine keeps (#1216): paragraphs, bold, italic, lists, links and line breaks, no raw HTML.
const extensions = [
  StarterKit.configure({
    blockquote: false,
    code: false,
    codeBlock: false,
    heading: false,
    horizontalRule: false,
    strike: false,
    trailingNode: false,
    underline: false,
    link: { autolink: false, openOnClick: false, protocols: ['mailto'], HTMLAttributes: { class: null, rel: null, target: null }, isAllowedUri: (url) => address.test(url) },
  }),
]

const Tool = ({ text, label, active, onUse, disabled, bold, italic }: { text: string; label: string; active: boolean; onUse: () => void; disabled: boolean; bold?: boolean; italic?: boolean }) => (
  <button type="button" className="df-rich-tool" aria-label={label} aria-pressed={active} disabled={disabled} style={{ fontWeight: bold ? 700 : undefined, fontStyle: italic ? 'italic' : undefined }} onMouseDown={(e) => e.preventDefault()} onClick={onUse}>
    {text}
  </button>
)

const Toolbar = ({ editor, disabled }: { editor: Editor; disabled: boolean }) => {
  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => ({ bold: e.isActive('bold'), italic: e.isActive('italic'), bulleted: e.isActive('bulletList'), numbered: e.isActive('orderedList'), link: e.isActive('link') }),
  })
  const [linking, setLinking] = useState(false)
  const [typed, setTyped] = useState('')
  const [problem, setProblem] = useState(false)
  const field = useRef<HTMLInputElement>(null)
  const addressId = useId()
  useEffect(() => {
    if (linking) field.current?.focus()
  }, [linking])

  const openLink = () => {
    setTyped((editor.getAttributes('link')['href'] as string | undefined) ?? '')
    setProblem(false)
    setLinking(true)
  }
  const closeLink = () => {
    setLinking(false)
    editor.commands.focus()
  }
  const addLink = () => {
    const href = /^[a-z][a-z0-9+.-]*:/i.test(typed.trim()) ? typed.trim() : `https://${typed.trim()}`
    if (!address.test(href)) return setProblem(true)
    const { from, to } = editor.state.selection
    if (from === to && !editor.isActive('link')) editor.chain().focus().insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] }).run()
    else editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
    setLinking(false)
  }
  const removeLink = () => {
    editor.chain().focus().extendMarkRange('link').unsetLink().run()
    setLinking(false)
  }

  return (
    <>
      <div className="df-rich-toolbar" role="toolbar" aria-label={words.toolbar}>
        <Tool text={words.tools.bold.text} label={words.tools.bold.label} active={active.bold} disabled={disabled} bold onUse={() => editor.chain().focus().toggleBold().run()} />
        <Tool text={words.tools.italic.text} label={words.tools.italic.label} active={active.italic} disabled={disabled} italic onUse={() => editor.chain().focus().toggleItalic().run()} />
        <Tool text={words.tools.bulleted.text} label={words.tools.bulleted.label} active={active.bulleted} disabled={disabled} onUse={() => editor.chain().focus().toggleBulletList().run()} />
        <Tool text={words.tools.numbered.text} label={words.tools.numbered.label} active={active.numbered} disabled={disabled} onUse={() => editor.chain().focus().toggleOrderedList().run()} />
        <Tool text={words.tools.link.text} label={words.tools.link.label} active={active.link} disabled={disabled} onUse={openLink} />
      </div>
      {linking && !disabled && (
        <div className="df-rich-link">
          <label htmlFor={addressId}>{words.linkAddress}</label>
          <input
            id={addressId}
            ref={field}
            type="url"
            value={typed}
            placeholder={words.linkPlaceholder}
            aria-invalid={problem}
            aria-describedby={problem ? `${addressId}-problem` : undefined}
            onChange={(e) => {
              setTyped(e.target.value)
              setProblem(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addLink()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                closeLink()
              }
            }}
          />
          <button type="button" className="df-button df-button--primary df-button--small" onClick={addLink}>
            {words.addLink}
          </button>
          {active.link && (
            <button type="button" className="df-button df-button--small" onClick={removeLink}>
              {words.removeLink}
            </button>
          )}
          <button type="button" className="df-button df-button--small" onClick={closeLink}>
            {words.cancelLink}
          </button>
          {problem && (
            <span id={`${addressId}-problem`} className="df-editor-problem">
              {words.badLink}
            </span>
          )}
        </div>
      )}
    </>
  )
}

/**
 * The description's editor: bold, italic, lists and links, never raw HTML. It holds the engine's stored form,
 * so `value` and `onChange` are what is saved; text typed before the editor was rich opens as paragraphs.
 */
export const RichTextField = ({ value, onChange, readOnly, labelledBy, placeholder }: { value: string; onChange: (html: string) => void; readOnly: boolean; labelledBy: string; placeholder: string }) => {
  const latest = useRef(onChange)
  latest.current = onChange
  const shown = useRef(value)
  const caret = useRef(1)
  const [refused, setRefused] = useState(false)
  const editor = useEditor({
    extensions,
    content: editorHtmlOf(value),
    editable: !readOnly,
    editorProps: { attributes: { role: 'textbox', 'aria-multiline': 'true', 'aria-labelledby': labelledBy, 'aria-placeholder': placeholder, 'aria-readonly': String(readOnly), class: 'df-rich-content' } },
    onUpdate: ({ editor: e }) => {
      const html = storedHtmlOf(e.getHTML())
      // Refused like a textarea's maxLength: back to the last accepted text, not an undo step that may hold more.
      if (html.length > limit) {
        e.commands.setContent(editorHtmlOf(shown.current), { emitUpdate: false })
        e.commands.setTextSelection(Math.min(caret.current, e.state.doc.content.size))
        setRefused(true)
        return
      }
      setRefused(false)
      shown.current = html
      caret.current = e.state.selection.from
      latest.current(html)
    },
  })
  useEffect(() => {
    editor.setEditable(!readOnly, false)
  }, [editor, readOnly])
  useEffect(() => {
    if (value === shown.current) return
    shown.current = value
    caret.current = 1
    editor.commands.setContent(editorHtmlOf(value), { emitUpdate: false })
  }, [editor, value])
  const empty = useEditorState({ editor, selector: ({ editor: e }) => e.isEmpty })

  return (
    <>
      <div className="df-rich" data-readonly={readOnly || undefined}>
        <Toolbar editor={editor} disabled={readOnly} />
        <div className="df-rich-body">
          <EditorContent editor={editor} />
          {empty && !readOnly && (
            <span className="df-rich-placeholder" aria-hidden="true">
              {placeholder}
            </span>
          )}
        </div>
      </div>
      {refused && (
        <p role="alert" className="df-editor-problem">
          {words.tooLong}
        </p>
      )}
    </>
  )
}
