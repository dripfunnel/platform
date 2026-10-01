import { useEffect, useState } from 'react'
import { Icon } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/shell.css'
import { fill, messages } from '../../messages'
import { SearchDialog } from './SearchDialog'

const words = messages.shell.search

const isMac = (): boolean => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)

export const SearchButton = () => {
  const [open, setOpen] = useState(false)
  const mac = isMac()

  useEffect(() => {
    const openOnShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen(true)
      }
    }
    document.addEventListener('keydown', openOnShortcut)
    return () => document.removeEventListener('keydown', openOnShortcut)
  }, [])

  return (
    <>
      <button
        type="button"
        className="df-search-button"
        aria-haspopup="dialog"
        aria-label={fill(words.buttonLabel, { shortcut: mac ? words.shortcutMacSpoken : words.shortcutOtherSpoken })}
        onClick={() => setOpen(true)}
      >
        <Icon name="search" size={16} />
        <span className="df-search-button-text">{words.button}</span>
        <kbd>{mac ? words.shortcutMac : words.shortcutOther}</kbd>
      </button>
      <SearchDialog open={open} onClose={() => setOpen(false)} />
    </>
  )
}
