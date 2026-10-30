export type CodeCheck = '1' | '0' | undefined

/** Whether a typed code counts as matching: any texted code does when CODE_CHECK is 0; an emailed one never does (#1002). */
export const codeMatches = (matches: boolean, mode: CodeCheck, kind: 'email' | 'text' = 'text'): boolean => (mode === '0' && kind === 'text') || matches
