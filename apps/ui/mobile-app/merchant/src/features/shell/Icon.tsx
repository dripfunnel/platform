import Svg, { Path } from 'react-native-svg'

// The prototype's icon paths (designs/mobile-app/merchant/DF Store App.dc.html, `ICON`), drawn on a 24-px grid in the
// colour they are given.
const paths = {
  home: 'M3 10.4 12 3.4l9 7 M5.4 9.2V20.4h13.2V9.2 M9.6 20.4v-6.6h4.8v6.6',
  orders: 'M3 7.6 12 3l9 4.6v8.8L12 21l-9-4.6z M3 7.6 12 12.2l9-4.6 M12 12.2V21',
  catalogue: 'M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z',
  products: 'M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z',
  toShip: 'M3 7.6 12 3l9 4.6v8.8L12 21l-9-4.6z M3 7.6 12 12.2l9-4.6 M12 12.2V21',
  offers: 'M3.6 12.4V3.6h8.8l8 8-8.8 8.8z M8 8h.01',
  more: 'M4 6h16 M4 12h16 M4 18h16',
  customers: 'M9 11.2a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8 M2.6 20c0-3.5 2.9-5.4 6.4-5.4s6.4 1.9 6.4 5.4',
  carts: 'M3 4h2.4l2.2 11h10.6l2-8H6.4 M9 20h.01 M17 20h.01',
  reports: 'M6 3.6h8.4L19 8.2v12.2H6z M14.2 3.6v4.6H19 M9.4 17.4v-3.2 M12 17.4v-6 M14.6 17.4v-2',
  storefront: 'M3.2 9.4 5.2 4h13.6l2 5.4 M3.2 9.4h17.6V20H3.2z M9 20v-5.8h6V20',
  settings: 'M4 7h16 M4 12.5h16 M4 18h16 M9.5 5.2v3.6 M15.5 10.7v3.6 M7.5 16.2v3.6',
  sales: 'M6 3.6h8.4L19 8.2v12.2H6z M14.2 3.6v4.6H19 M9.4 17.4v-3.2 M12 17.4v-6 M14.6 17.4v-2',
  team: 'M9 11.2a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8 M2.6 20c0-3.5 2.9-5.4 6.4-5.4s6.4 1.9 6.4 5.4',
  profile: 'M9 11.2a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8 M2.6 20c0-3.5 2.9-5.4 6.4-5.4s6.4 1.9 6.4 5.4',
  switchStore: 'M3.2 9.4 5.2 4h13.6l2 5.4 M3.2 9.4h17.6V20H3.2z M9 20v-5.8h6V20',
  signOut: 'M14 4h5v16h-5 M10 8l-4 4 4 4 M6 12h10',
  chevron: 'M9 5l7 7-7 7',
  back: 'M15 5l-7 7 7 7',
  help: 'M12 3.4a8.6 8.6 0 1 0 0 17.2 8.6 8.6 0 0 0 0-17.2z M9.6 9.4a2.4 2.4 0 1 1 3.4 2.2c-.6.3-1 .9-1 1.6v.6 M12 16.8h.01',
  lock: 'M6 11h12v9H6z M8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  close: 'M6 6l12 12 M18 6 6 18',
} as const

export type IconName = keyof typeof paths

export function Icon({ name, size = 22, color, strokeWidth = 1.7 }: { name: IconName; size?: number; color: string; strokeWidth?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Path d={paths[name]} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
}

export const hasIcon = (name: string): name is IconName => name in paths
