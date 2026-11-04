import type { ReactNode } from 'react'

/** An empty, missing or failed state: its heading (the page's h1 when `main`), a line, and what the shopper can do next. */
export const Notice = ({ title, lead, main = false, children }: { title: string; lead: string; main?: boolean; children?: ReactNode }) => (
  <div className="py-12 px-4 flex flex-col items-center gap-y-2.5 gap-x-2.5 text-center">
    {main ? <h1 className="m-0 font-heading text-[24px] font-[var(--heading-weight)] leading-[1.2] wrap-anywhere [text-transform:var(--heading-case)]">{title}</h1> : <h2 className="m-0 font-heading text-[24px] font-[var(--heading-weight)] leading-[1.2] wrap-anywhere [text-transform:var(--heading-case)]">{title}</h2>}
    <p className="m-0 max-w-[52ch] text-muted">{lead}</p>
    {children ? <div className="group/shop-noticeActions mt-1.5 flex flex-wrap justify-center gap-y-2.5 gap-x-2.5">{children}</div> : null}
  </div>
)
