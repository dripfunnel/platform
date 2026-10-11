/** Which step of the fast gate refused the change (storefront ARCHITECTURE §6.2); the repair loop reads them all. */
export type GateStep = 'validator' | 'typecheck' | 'bundle' | 'budget'

export type GateProblem = { step: GateStep; file: string | null; line: number | null; rule: string; message: string }
