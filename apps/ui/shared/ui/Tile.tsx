import './list.css'

// A record's initials, standing in for its logo until the API serves logo files.
export interface TileProps {
  name: string
  large?: boolean
  // For records without a brand colour of their own, such as stores.
  neutral?: boolean
  // When there is no name to take them from, such as a deleted customer.
  initials?: string
}

export const Tile = ({ name, large = false, neutral = false, initials }: TileProps) => (
  <span className={['df-initials', large && 'df-initials--large', neutral && 'df-initials--neutral'].filter(Boolean).join(' ')} aria-hidden="true">
    {initials ??
      name
        .split(/\s+/)
        .filter((word) => /^[\p{L}\p{N}]/u.test(word))
        .slice(0, 2)
        .map((word) => word[0])
        .join('')
        .toUpperCase()}
  </span>
)
