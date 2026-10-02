import { Icon, isBackdropClick } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/shell.css'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { searchStores, type StoreMatch } from '../../api/stores'
import { messages } from '../../messages'
import './search.css'
import { SearchResults } from './SearchResults'

const words = messages.shell.search

// Waits for a pause in typing, so each keystroke doesn't become a request.
const searchDelayMs = 250

// The header's search over the partner's stores (FIRST-RELEASE.md §2.2): a dialog opened by the button
// or ⌘K, results as you type, Enter for the whole list filtered by the text.
export const SearchPalette = () => {
  const dialog = useRef<HTMLDialogElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<readonly StoreMatch[] | 'failed' | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    const element = dialog.current
    if (!element) return
    if (open && !element.open) element.showModal()
    if (!open && element.open) element.close()
  }, [open])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setQuery('')
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (query.trim() === '') return setMatches(null)
    setMatches(null)
    let current = true
    const timer = setTimeout(() => {
      searchStores(query).then(
        (found) => current && setMatches(found),
        () => current && setMatches('failed'),
      )
    }, searchDelayMs)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [query])

  const close = () => setOpen(false)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const q = query.trim()
    if (!q) return
    close()
    void navigate({ to: '/stores', search: { q } })
  }

  return (
    <>
      <button type="button" className="df-search-button" aria-label={words.shortcutLabel} onClick={() => setOpen(true)}>
        <Icon name="search" size={16} />
        <span className="df-search-button-text">{words.button}</span>
        <kbd>{words.shortcut}</kbd>
      </button>
      <dialog ref={dialog} className="df-search-dialog" aria-label={words.label} onClose={close} onClick={(event) => isBackdropClick(event) && close()}>
        <form role="search" className="df-search-form" onSubmit={submit}>
          <Icon name="search" size={18} />
          <input type="search" value={query} placeholder={words.placeholder} aria-label={words.label} autoFocus onChange={(event) => setQuery(event.target.value)} />
          <kbd>{words.esc}</kbd>
        </form>
        <SearchResults query={query} matches={matches} onPick={close} />
      </dialog>
    </>
  )
}
