export type CodeCheck = '1' | '0' | undefined

/** Whether a typed code counts as matching: any code does when CODE_CHECK is 0. */
export const codeMatches = (matches: boolean, mode: CodeCheck): boolean => mode === '0' || matches
