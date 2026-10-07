let checking = true

/** Set from CODE_CHECK on each request; `0` exists for dev only (config.ts refuses it elsewhere). */
export const setCodeCheck = (mode: '1' | '0' | undefined): void => {
  checking = mode !== '0'
}

/** Whether a typed code counts as matching: any code does while CODE_CHECK is 0. */
export const codeMatches = (matches: boolean): boolean => !checking || matches
