import type { ReactNode } from 'react'
import styles from '../styles/shop.module.css'

/** An empty, missing or failed state: its heading (the page's h1 when `main`), a line, and what the shopper can do next. */
export const Notice = ({ title, lead, main = false, children }: { title: string; lead: string; main?: boolean; children?: ReactNode }) => (
  <div className={styles.notice}>
    {main ? <h1 className={styles.noticeTitle}>{title}</h1> : <h2 className={styles.noticeTitle}>{title}</h2>}
    <p className={styles.noticeLead}>{lead}</p>
    {children ? <div className={styles.noticeActions}>{children}</div> : null}
  </div>
)
