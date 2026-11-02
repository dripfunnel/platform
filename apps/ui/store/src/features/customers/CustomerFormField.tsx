import { useId, type ReactNode } from 'react'

export interface FieldAttrs {
  id: string
  'aria-invalid': true | undefined
  'aria-describedby': string | undefined
}

/** A customer form's label and input with what the API refused the field for under it (design.md §8). */
export const CustomerFormField = ({ label, hint, error, children }: { label: string; hint?: string; error: string | null; children: (attrs: FieldAttrs) => ReactNode }) => {
  const id = useId()
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
