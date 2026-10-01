import './list.css'

// A record's initials, standing in for its logo until the API serves logo files.
// `neutral` is for records without a brand colour of their own, such as stores. `initials`
// stands in when there is no name to take them from, such as a deleted customer.
export interface TileProps {
  name: string
  large?: boolean
  neutral?: boolean
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
