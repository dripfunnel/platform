import { useState } from 'react'
import { messages } from '../../messages'
import { ConfirmDialog } from './ConfirmDialog'
import './states.css'

const words = messages.states.confirm

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
        confirmLabel={words.confirm}
        cancelLabel={words.cancel}
        reasonLabel={words.reason}
        onConfirm={() => setOpen(false)}
        onCancel={() => setOpen(false)}
      />
    </div>
  )
}
