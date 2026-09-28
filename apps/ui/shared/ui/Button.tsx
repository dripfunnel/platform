import type { ButtonHTMLAttributes } from 'react'

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement>

export const Button = ({ type = 'button', style, ...props }: ButtonProps) => (
  <button
    type={type}
    style={{
      background: 'var(--df-color-brand)',
      color: 'var(--df-color-brand-contrast)',
      border: 0,
      borderRadius: 'var(--df-radius)',
      padding: 'var(--df-space-2) var(--df-space-4)',
      font: 'inherit',
      cursor: 'pointer',
      ...style,
    }}
    {...props}
  />
)
