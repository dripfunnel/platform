import { useId, useRef, type KeyboardEvent } from 'react'
import { fill, messages, plural } from '../../messages'
import { languageName } from './TranslationView'

const words = messages.editor.translate

export interface LanguageTabsProps {
  main: string
  others: string[]
  selected: string | null
  /** Languages left to translate, by code; unknown until that tab has been read. */
  todo: Record<string, number>
  /** Switching is held while a translation has unsaved edits. */
  locked: boolean
  panelId: string
  onSelect: (code: string | null) => void
}

export const languageTabId = (base: string, code: string | null) => `${base}-${code ?? 'main'}`

/** The main language and each translation, as tabs over the editor (WAI-ARIA tabs: arrows, Home and End). */
export const LanguageTabs = ({ main, others, selected, todo, locked, panelId, onSelect }: LanguageTabsProps) => {
  const labelId = useId()
  const tabs = useRef(new Map<string | null, HTMLButtonElement>())
  const codes = [null, ...others]
  const open = codes.filter((code) => !locked || code === selected)

  const onKeyDown = (event: KeyboardEvent) => {
    const at = open.indexOf(selected)
    const next = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: open.length - 1 }[event.key]
    if (next === undefined) return
    event.preventDefault()
    const code = open[(next + open.length) % open.length] ?? null
    onSelect(code)
    tabs.current.get(code)?.focus()
  }

  return (
    <div className="df-editor-languages">
      <span id={labelId}>{words.tabs}</span>
      <div role="tablist" aria-labelledby={labelId} onKeyDown={onKeyDown}>
        {codes.map((code) => (
          <button
            key={code ?? 'main'}
            ref={(el) => void (el ? tabs.current.set(code, el) : tabs.current.delete(code))}
            id={languageTabId(panelId, code)}
            type="button"
            role="tab"
            aria-selected={selected === code}
            aria-controls={panelId}
            tabIndex={selected === code ? 0 : -1}
            disabled={locked && selected !== code}
            onClick={() => onSelect(code)}
          >
            {code === null ? fill(words.main, { language: languageName(main) }) : languageName(code)}
            {code !== null && todo[code] !== undefined && <span>{todo[code] === 0 ? words.done : fill(plural(words.todo, todo[code] ?? 0), { count: String(todo[code]) })}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}
