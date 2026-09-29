import './states.css'

export interface ReadOnlyNoticeProps {
  title: string
  body: string
}

export const ReadOnlyNotice = ({ title, body }: ReadOnlyNoticeProps) => (
  <section className="df-state df-state--warning" role="status">
    <h2>{title}</h2>
    <p>{body}</p>
  </section>
)
