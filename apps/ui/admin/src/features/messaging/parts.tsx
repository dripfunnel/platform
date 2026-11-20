import type { ReactNode } from 'react'

export const Button = ({ label, short, primary = false, disabled, onClick }: { label: string; short?: string; primary?: boolean; disabled: boolean; onClick: () => void }) => (
  <button type="button" className={primary ? 'df-button df-button--primary' : 'df-button'} aria-label={short ? label : undefined} disabled={disabled} onClick={onClick}>
    {short ?? label}
  </button>
)

export const Fact = ({ term, children }: { term: string; children: ReactNode }) => (
  <>
    <dt>{term}</dt>
    <dd>{children}</dd>
  </>
)
