import type { ReactNode } from 'react'
import './list.css'

// A read-only fact and the way round it, in the info palette, never the warning one
// (decided on #19): nothing is wrong, the change is made elsewhere.
export const InfoNote = ({ children }: { children: ReactNode }) => <p className="df-info-note">{children}</p>
