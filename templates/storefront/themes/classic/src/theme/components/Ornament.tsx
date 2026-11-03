/** The taupe line-and-diamond rule under section headings. */
export const Ornament = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 240 12" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
    <line x1="0" y1="6" x2="104" y2="6" stroke="currentColor" strokeWidth="1" />
    <path d="M120 0l6 6-6 6-6-6z" fill="currentColor" />
    <line x1="136" y1="6" x2="240" y2="6" stroke="currentColor" strokeWidth="1" />
  </svg>
)
