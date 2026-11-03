import { Ornament } from './Ornament'
import styles from '../styles/home.module.css'

/** The centred eyebrow, serif title and taupe ornament that open a home page section. */
export const SectionHeading = ({ eyebrow, title }: { eyebrow: string; title: string }) => (
  <div className={styles.sectionHead}>
    <p className={styles.eyebrow}>{eyebrow}</p>
    <h2 className={styles.heading}>{title}</h2>
    <Ornament className={styles.ornament} />
  </div>
)
