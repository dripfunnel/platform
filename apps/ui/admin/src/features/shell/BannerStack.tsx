import type { ReactNode } from 'react'
import './shell.css'

// Full-width banners under the header (design.md §4). The environment strip is the first;
// provisioning, trial ending, past due, offline and the setup-session bar join it here.
export const BannerStack = ({ children }: { children: ReactNode }) => (
  <div className="df-banners">{children}</div>
)
