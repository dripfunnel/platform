import { useState } from 'react'
import { Button } from '../common/Button'
import { PickerSheet, type PickerOption } from './PickerField'

type Props = { label: string; options: readonly PickerOption[]; onPick: (value: string) => void; disabled?: boolean; searchable?: boolean }

// "+ Add a currency": a button that opens the list to add from, and closes with the pick. Absent when there is nothing left to add.
export function AddFromList({ label, options, onPick, disabled = false, searchable = false }: Props) {
  const [open, setOpen] = useState(false)
  if (options.length === 0) return null
  return (
    <>
      <Button kind="secondary" label={label} disabled={disabled} onPress={() => setOpen(true)} />
      {open ? (
        <PickerSheet
          title={label}
          value={null}
          options={options}
          searchable={searchable}
          onClose={() => setOpen(false)}
          onPick={(picked) => {
            setOpen(false)
            onPick(picked)
          }}
        />
      ) : null}
    </>
  )
}
