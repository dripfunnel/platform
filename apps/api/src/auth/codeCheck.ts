export type CodeCheck = '1' | '0' | undefined

/** Whether a typed code counts as matching: any code does when CODE_CHECK is 0 (config.ts allows that on dev and localhost only). */
export const codeMatches = (matches: boolean, mode: CodeCheck): boolean => mode === '0' || matches
