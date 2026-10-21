import './states.css'

export interface ReadOnlyNoticeProps {
  title: string
  body: string
}

// Info, not warning: read-only is a fact about your access, not something going wrong. The
// admin prototype draws these panels in the info palette (--info-bg / --info-fg / --info-bd).
export const ReadOnlyNotice = ({ title, body }: ReadOnlyNoticeProps) => (
  <section className="df-state df-state--info" role="status">
    <h2>{title}</h2>
    <p>{body}</p>
  </section>
)
