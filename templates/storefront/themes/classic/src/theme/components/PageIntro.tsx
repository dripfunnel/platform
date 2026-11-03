import type { ReactNode } from 'react'
import styles from '../styles/page.module.css'

export const PageIntro = ({ title, lead, children }: { title: string; lead: string; children?: ReactNode }) => (
  <section className={styles.page}>
    <h1 className={styles.title}>{title}</h1>
    <p className={styles.lead}>{lead}</p>
    {children}
  </section>
)
