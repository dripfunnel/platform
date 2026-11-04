import type { ReactNode } from 'react'

export const PageIntro = ({ title, lead, children }: { title: string; lead: string; children?: ReactNode }) => (
  <section className="pt-10 pr-4 pb-2 pl-4 flex box-border w-[min(100%,1240px)] flex-col items-start gap-y-3.5 gap-x-3.5 mx-auto min-[900px]:pt-14 min-[900px]:pr-8 min-[900px]:pb-2 min-[900px]:pl-8">
    <h1 className="m-0 max-w-[22ch] font-heading text-[32px] font-[var(--heading-weight)] tracking-[-0.01em] leading-[1.15] wrap-anywhere [text-transform:var(--heading-case)] min-[900px]:text-[40px]">{title}</h1>
    <p className="m-0 max-w-[56ch] text-ink-soft text-[16px]">{lead}</p>
    {children}
  </section>
)
