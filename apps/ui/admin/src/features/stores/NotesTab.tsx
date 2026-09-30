import { useState } from 'react'
import { storeNoteMaxLength, type Store } from '../../api/stores'
import { fill, formatTime, messages } from '../../messages'
import { ActionControl } from '../common/ActionControl'
import { refusalText } from './refusal'

const words = messages.store.notes

export interface NotesTabProps {
  store: Store
  onAddNote: (text: string) => Promise<boolean>
}

// Written inline, not in a dialog (decided on #20). A refused caller sees the field turned off
// and why, as the prototype does.
export const NotesTab = ({ store, onAddNote }: NotesTabProps) => {
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const permission = store.actions.addNote
  const refusal = permission ? refusalText(permission, 'addNote') : null
  const add = () => {
    setSaving(true)
    void onAddNote(text.trim())
      .then((saved) => {
        if (saved) setText('')
      })
      .finally(() => setSaving(false))
  }
  return (
    <div className="df-panels">
      <section className="df-panel df-panel--wide" aria-labelledby="store-notes">
        <div className="df-panel-head">
          <h2 id="store-notes">{words.title}</h2>
          <span className="df-muted">{words.sub}</span>
        </div>
        {permission && (
          <div className="df-field">
            <textarea
              rows={3}
              maxLength={storeNoteMaxLength}
              aria-label={words.label}
              placeholder={words.placeholder}
              disabled={refusal !== null}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
            <ActionControl
              label={words.add}
              refusal={refusal}
              primary
              disabled={saving || text.trim() === ''}
              onRun={add}
            />
          </div>
        )}
        {store.notes.length === 0 ? (
          <p className="df-muted">{words.none}</p>
        ) : (
          <ol className="df-history">
            {store.notes.map((note) => (
              <li key={note.id}>
                <span className="df-muted">{fill(words.by, { by: note.by, time: formatTime(note.at) })}</span>
                <span>{note.text}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}
