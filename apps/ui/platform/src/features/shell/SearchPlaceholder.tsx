import { Icon } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/shell.css'
import '@dripfunnel/shared/ui/states.css'
import { useId } from 'react'
import { messages } from '../../messages'
import './partner.css'

const words = messages.shell.search

// The header's search over the partner's stores (FIRST-RELEASE.md §2.2) is wired by #115; until
// then the control is here, disabled, and says why.
export const SearchPlaceholder = () => {
  const noteId = useId()
  return (
    <>
      <button type="button" className="df-search-button" disabled aria-describedby={noteId}>
        <Icon name="search" size={16} />
        <span className="df-search-button-text">{words.button}</span>
      </button>
      <span id={noteId} className="df-visually-hidden">
        {words.notYet}
      </span>
    </>
  )
}
