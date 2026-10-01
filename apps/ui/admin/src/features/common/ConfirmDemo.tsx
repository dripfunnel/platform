import { useState } from 'react'
import { messages } from '../../messages'
import { ConfirmDialog } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/states.css'

const words = messages.states.confirm

// The admin prototype's "Close partner" dialog: the consequence, what it also affects, a
// reason for the activity log, and the partner's own name typed exactly.
export const ConfirmDemo = () => {
  const [open, setOpen] = useState(false)
  return (
    <div className="df-actions">
      <button type="button" className="df-button" onClick={() => setOpen(true)}>
        {words.open}
      </button>
      <ConfirmDialog
        open={open}
        danger
        title={words.title}
        target={words.target}
        consequence={words.consequence}
        notes={words.notes}
        confirmLabel={words.confirm}
        cancelLabel={words.cancel}
        reason={{ label: words.reason, hint: words.reasonHint }}
        typeToConfirm={{ label: words.typeLabel, hint: words.typeHint, expected: words.typeExpected }}
        onConfirm={() => setOpen(false)}
        onCancel={() => setOpen(false)}
      />
    </div>
  )
}
