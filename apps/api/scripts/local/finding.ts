export interface Finding {
  level: 'error' | 'warning'
  problem: string
  fix: string
}

export const error = (problem: string, fix: string): Finding => ({ level: 'error', problem, fix })
export const warning = (problem: string, fix: string): Finding => ({ level: 'warning', problem, fix })
