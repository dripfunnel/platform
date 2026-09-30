import './list.css'

// A record's initials, standing in for its logo until the API serves logo files.
// `neutral` is for records without a brand colour of their own, such as stores.
export const Tile = ({ name, large = false, neutral = false }: { name: string; large?: boolean; neutral?: boolean }) => (
  <span className={['df-initials', large && 'df-initials--large', neutral && 'df-initials--neutral'].filter(Boolean).join(' ')} aria-hidden="true">
    {name
      .split(/\s+/)
      .filter((word) => /^[\p{L}\p{N}]/u.test(word))
      .slice(0, 2)
      .map((word) => word[0])
      .join('')
      .toUpperCase()}
  </span>
)
