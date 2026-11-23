import { useEffect, useId, type ReactNode } from 'react'

export interface FieldAttrs {
  id: string
  'aria-invalid': true | undefined
  'aria-describedby': string | undefined
}

/** A customer form's label and input with what the API refused the field for under it (design.md §8). */
export const CustomerFormField = ({ label, hint, error, focusKey, children }: { label: string; hint?: string; error: string | null; focusKey?: unknown; children: (attrs: FieldAttrs) => ReactNode }) => {
  const id = useId()
  // The field at fault takes focus, again on a new refusal (`focusKey`) even when its words are the same.
  useEffect(() => {
    if (error) document.getElementById(id)?.focus()
  }, [error, id, focusKey])
  return (
    <div className="df-form-field">
      <label htmlFor={id}>
        {label} {hint && <small>{hint}</small>}
      </label>
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': error ? `${id}-error` : undefined })}
      {error && (
        <small id={`${id}-error`} className="df-form-error" role="alert">
          {error}
        </small>
      )}
    </div>
  )
}
