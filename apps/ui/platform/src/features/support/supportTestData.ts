import type { SupportSession, SupportTarget } from '../../api/support'

export const target = (over: Partial<SupportTarget> = {}): SupportTarget => ({
  membershipId: 'm1',
  userId: 'u1',
  name: 'Jenna Park',
  email: 'jenna@juniper.example',
  type: 'store',
  store: { id: 's1', name: 'Juniper & Co.' },
  role: 'owner',
  supplier: null,
  lastSignInAt: '2026-10-01T09:00:00.000Z',
  status: 'active',
  start: { allowed: true },
  storeOwner: null,
  colleague: null,
  mySessionId: null,
  ...over,
})

export const session = (over: Partial<SupportSession> = {}): SupportSession => ({
  id: 'ss1',
  user: { name: 'Jenna Park', role: 'owner', supplier: null },
  store: { id: 's1', name: 'Juniper & Co.' },
  agent: { id: 'p1', name: 'Priya Shah' },
  you: true,
  reason: 'Checkout shows the wrong tax',
  ticket: 'https://help.northstar.example/t/48213',
  startedAt: '2026-10-04T10:00:00.000Z',
  expiresAt: '2026-10-04T10:30:00.000Z',
  endedAt: null,
  endedBy: null,
  endedByName: null,
  end: { allowed: true },
  return: { allowed: true },
  ...over,
})
