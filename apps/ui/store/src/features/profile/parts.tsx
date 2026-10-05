import type { ReactNode } from 'react'
import { Field as CommonField, Primary as CommonPrimary, Secondary as CommonSecondary, type FieldProps as CommonFieldProps } from '../common/fields'

// PortalProfile's pieces: a card per section, and the portal's field and buttons in its look (common/fields).

export const Card = ({ title, sub, aside, children }: { title: string; sub?: ReactNode; aside?: ReactNode; children?: ReactNode }) => (
  <section className="df-profile-card">
    <div className="df-profile-card-head">
      <div className="df-profile-card-title">
        <h2>{title}</h2>
        {sub && <p>{sub}</p>}
      </div>
      {aside}
    </div>
    {children}
  </section>
)

type FieldProps = Omit<CommonFieldProps, 'look' | 'helpTone'> & { helpTone?: 'muted' | 'good' | undefined }

export const Field = ({ helpTone = 'muted', ...props }: FieldProps) => <CommonField look="profile" helpTone={helpTone} {...props} />

export const Primary = ({ children, onClick, busy, disabled, type = 'button' }: { children: ReactNode; onClick?: () => void; busy?: boolean; disabled?: boolean; type?: 'button' | 'submit' }) => (
  <CommonPrimary look="profile" type={type} onClick={onClick} busy={busy} disabled={disabled}>
    {children}
  </CommonPrimary>
)

export const Secondary = ({ children, onClick, size }: { children: ReactNode; onClick: () => void; size?: 'small' | 'strong' }) => (
  <CommonSecondary look="profile" onClick={onClick} size={size}>
    {children}
  </CommonSecondary>
)

export const Alert = ({ text }: { text: string | null }) =>
  text ? (
    <p role="alert" className="df-profile-alert">
      {text}
    </p>
  ) : null
