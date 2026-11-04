import { Ornament } from './Ornament'

/** The centred eyebrow, serif title and taupe ornament that open a home page section. */
export const SectionHeading = ({ eyebrow, title }: { eyebrow: string; title: string }) => (
  <div className="mb-10 flex flex-col items-center gap-y-3 gap-x-3 text-center min-[900px]:mb-14">
    <p className="m-0 text-accent text-[12px] font-semibold tracking-[0.25em] uppercase">{eyebrow}</p>
    <h2 className="m-0 font-heading text-[32px] font-[var(--heading-weight)] leading-[1.15] [text-wrap:balance] min-[900px]:text-[48px]">{title}</h2>
    <Ornament className="mt-1 mr-auto mb-0 ml-auto block w-[min(100%,240px)] h-3 text-taupe" />
  </div>
)
