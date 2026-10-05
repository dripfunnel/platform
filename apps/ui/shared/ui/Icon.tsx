// One outline set for both consoles (designs/design.md §4: 18px, 1.6px stroke); the paths are
// the prototypes' own.
const paths = {
  // The merchant portal's menu (designs/DF Store Prototype.dc.html, its ICON map).
  house: 'M3 10.4 12 3.4l9 7 M5.4 9.2V20.4h13.2V9.2 M9.6 20.4v-6.6h4.8v6.6',
  orders: 'M3 7.6 12 3l9 4.6v8.8L12 21l-9-4.6z M3 7.6 12 12.2l9-4.6 M12 12.2V21',
  customers: 'M9 11.2a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8 M2.6 20c0-3.5 2.9-5.4 6.4-5.4s6.4 1.9 6.4 5.4',
  offers: 'M3.6 12.4V3.6h8.8l8 8-8.8 8.8z M8 8h.01',
  carts: 'M3 4h2.4l2.2 11h10.6l2-8H6.4 M9 20h.01 M17 20h.01',
  reports: 'M6 3.6h8.4L19 8.2v12.2H6z M14.2 3.6v4.6H19 M9.4 17.4v-3.2 M12 17.4v-6 M14.6 17.4v-2',
  products: 'M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z',
  collections: 'M12 3 3 7.8l9 4.8 9-4.8z M3 12.2 12 17l9-4.8 M3 16.6 12 21.4l9-4.8',
  storefront: 'M3.2 9.4 5.2 4h13.6l2 5.4 M3.2 9.4h17.6V20H3.2z M9 20v-5.8h6V20',
  settings: 'M4 7h16 M4 12.5h16 M4 18h16 M9.5 5.2v3.6 M15.5 10.7v3.6 M7.5 16.2v3.6',
  billing: 'M2.6 6.4h18.8v11.2H2.6z M2.6 10.4h18.8 M6 14.4h3.4',
  sales: 'M4 19.5h16 M6.5 16V11 M11 16V6.5 M15.5 16v-7 M20 16V4',
  team: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6 M16.5 10a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5 M2.5 19.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5 M14 14.6c.8-.4 1.6-.6 2.5-.6 2.8 0 5 1.8 5 4.6',
  home: 'M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z',
  users:
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  cart: 'M6 6h15l-1.5 9h-12zM6 6 5 3H2M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM18 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  shop: 'M3 9l1.5-5h15L21 9M3 9v11h18V9M3 9h18M9 20v-6h6v6',
  approve: 'M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  pulse: 'M22 12h-4l-3 9L9 3l-3 9H2',
  staff: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1',
  mask: 'M2 8c3-2 7-2 10 0 3-2 7-2 10 0v3c0 4-3 7-5 7s-3-2-5-2-3 2-5 2-5-3-5-7zM7 11h2M15 11h2',
  layers: 'M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  brush: 'M9.5 14.5 3 21M14 4l6 6-8.5 8.5a3 3 0 0 1-4.2 0l-1.8-1.8a3 3 0 0 1 0-4.2zM17 7l3-3',
  globe: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20',
  chart: 'M3 3v18h18M7 15v3M12 10v8M17 6v12',
  card: 'M2 6h20v12H2zM2 10h20M6 15h4',
  buoy: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.9 4.9l4.3 4.3M14.8 14.8l4.3 4.3M14.8 9.2l4.3-4.3M4.9 19.1l4.3-4.3',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.8 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.8-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.8H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 2.8-1.2V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.8 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.8H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35',
  menu: 'M3 6h18M3 12h18M3 18h18',
  close: 'M6 6l12 12M18 6 6 18',
  ok: 'M22 11.1V12a10 10 0 1 1-5.9-9.1M22 4 12 14l-3-3',
  hour: 'M6 2h12M6 22h12M7 2c0 5 5 6 5 10s-5 5-5 10M17 2c0 5-5 6-5 10s5 5 5 10',
  pen: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  pause: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM10 9v6M14 9v6',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 7v5l3 2',
  cross: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM15 9l-6 6M9 9l6 6',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  ban: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM4.9 4.9l14.2 14.2',
  caret: 'M6 9l6 6 6-6',
  chevron: 'M9 6l6 6-6 6',
  alert: 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01',
} satisfies Record<string, string>

export type IconName = keyof typeof paths

export type StatusIconName = Extract<IconName, 'ok' | 'hour' | 'pen' | 'pause' | 'clock' | 'ban' | 'alert' | 'cross' | 'shield'>

export const Icon = ({ name, size = 18, strokeWidth = 1.6 }: { name: IconName; size?: number; strokeWidth?: number }) => (
  <svg
    className="df-icon"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path d={paths[name]} />
  </svg>
)
