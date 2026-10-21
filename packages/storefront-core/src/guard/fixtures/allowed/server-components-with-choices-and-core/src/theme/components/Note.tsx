import type { ReactNode } from 'react'
import styles from '../styles/page.module.css'

type Tone = 'warm' | 'cool'

export const Note = ({ tone = 'warm', heading, children }: { tone?: Tone; heading: string; children: ReactNode }) => (
  <section className={tone === 'warm' ? styles.lead : styles.body}>
    <h2>{heading}</h2>
    {children}
  </section>
)
